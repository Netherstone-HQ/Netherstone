//! Laying out shapes: placing new ones, routing arrows, centering labels,
//! and adding, changing and removing shapes.

use super::scene::{
    base, bind, bump, find, find_mut, is_live, new_id, num_of, str_of, text_element, text_size,
};
use super::{ShapeKind, ShapeSpec};
use crate::tools::{ToolError, ToolResult};
use serde_json::{Value, json};

/// The size of a shape given none, and the gap left between shapes.
pub(super) const SHAPE_WIDTH: f64 = 180.0;
pub(super) const SHAPE_HEIGHT: f64 = 80.0;
const SHAPE_GAP: f64 = 80.0;
/// How far an arrow stops from the shapes it connects.
const ARROW_GAP: f64 = 6.0;

/// The box a shape takes up.
fn bounds(element: &Value) -> (f64, f64, f64, f64) {
    (
        num_of(element, "x"),
        num_of(element, "y"),
        num_of(element, "width"),
        num_of(element, "height"),
    )
}

/// Where the line from the middle of `from` towards `toward` leaves `from`'s box.
fn edge_point(from: (f64, f64, f64, f64), toward: (f64, f64)) -> (f64, f64) {
    let (x, y, w, h) = from;
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let (dx, dy) = (toward.0 - cx, toward.1 - cy);
    if dx == 0.0 && dy == 0.0 {
        return (cx, cy);
    }
    let scale = ((w / 2.0 + ARROW_GAP) / dx.abs()).min((h / 2.0 + ARROW_GAP) / dy.abs());
    (cx + dx * scale, cy + dy * scale)
}

/// Puts a label's text in the middle of its shape.
fn center_label(list: &mut [Value], container: &str) {
    let Some(shape) = find(list, container).map(bounds) else {
        return;
    };
    if let Some(label) = list
        .iter_mut()
        .find(|e| str_of(e, "containerId") == Some(container) && is_live(e))
    {
        let (w, h) = (num_of(label, "width"), num_of(label, "height"));
        place(
            label,
            [
                ("x", json!(shape.0 + (shape.2 - w) / 2.0)),
                ("y", json!(shape.1 + (shape.3 - h) / 2.0)),
            ],
        );
    }
}

/// Sets `fields` on `element`, marking it edited when any of them moved, so
/// a drawing merge keeps the new place.
fn place<const N: usize>(element: &mut Value, fields: [(&str, Value); N]) {
    let moved = fields
        .iter()
        .any(|(key, value)| !element.get(*key).is_some_and(|now| same_place(now, value)));
    if !moved {
        return;
    }
    for (key, value) in fields {
        element[key] = value;
    }
    bump(element);
}

/// Whether two positions are equal as numbers: the canvas saves whole
/// numbers as `100`, and the layout writes `100.0`.
fn same_place(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_place(a, b))
        }
        _ => a == b,
    }
}

/// Lays an arrow between the shapes it connects.
fn route(list: &mut [Value], arrow: &str) {
    let Some(element) = find(list, arrow) else {
        return;
    };
    let end = |key: &str| {
        element
            .get(key)
            .and_then(|b| b.get("elementId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let (Some(start), Some(end)) = (end("startBinding"), end("endBinding")) else {
        return;
    };
    let (Some(a), Some(b)) = (find(list, &start).map(bounds), find(list, &end).map(bounds)) else {
        return;
    };
    let middle = |r: (f64, f64, f64, f64)| (r.0 + r.2 / 2.0, r.1 + r.3 / 2.0);
    let from = edge_point(a, middle(b));
    let to = edge_point(b, middle(a));
    if let Some(element) = find_mut(list, arrow) {
        place(
            element,
            [
                ("x", json!(from.0)),
                ("y", json!(from.1)),
                ("width", json!((to.0 - from.0).abs())),
                ("height", json!((to.1 - from.1).abs())),
                (
                    "points",
                    json!([[0.0, 0.0], [to.0 - from.0, to.1 - from.1]]),
                ),
            ],
        );
    }
    if let Some(label) = list
        .iter()
        .find(|e| str_of(e, "containerId") == Some(arrow) && is_live(e))
    {
        let id = str_of(label, "id").unwrap_or_default().to_string();
        let (w, h) = (num_of(label, "width"), num_of(label, "height"));
        if let Some(label) = find_mut(list, &id) {
            place(
                label,
                [
                    ("x", json!((from.0 + to.0 - w) / 2.0)),
                    ("y", json!((from.1 + to.1 - h) / 2.0)),
                ],
            );
        }
    }
}

pub(super) fn add_shapes(list: &mut Vec<Value>, specs: &[ShapeSpec]) -> ToolResult<Vec<String>> {
    let mut added = Vec::new();
    for spec in specs {
        let kind = spec
            .kind
            .ok_or_else(|| ToolError("A new shape needs a type".to_string()))?;
        let id = spec
            .id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(new_id);
        if list.iter().any(|e| str_of(e, "id") == Some(id.as_str())) {
            return Err(ToolError(format!(
                "The drawing already has a shape with id '{}'",
                id
            )));
        }
        // Right of everything else, on the top row, unless placed.
        let right = list
            .iter()
            .filter(|e| is_live(e))
            .map(|e| num_of(e, "x") + num_of(e, "width"))
            .fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.max(r))));
        let top = list
            .iter()
            .filter(|e| is_live(e))
            .map(|e| num_of(e, "y"))
            .fold(None, |m: Option<f64>, t| Some(m.map_or(t, |m| m.min(t))));
        let x = spec
            .x
            .unwrap_or_else(|| right.map_or(0.0, |r| r + SHAPE_GAP));
        let y = spec.y.unwrap_or_else(|| top.unwrap_or(0.0));

        let mut element = if kind == ShapeKind::Text {
            text_element(&id, spec.text.as_deref().unwrap_or(""), x, y, None)
        } else {
            let mut element = base(
                &id,
                kind.name(),
                x,
                y,
                spec.width
                    .unwrap_or(if kind.is_link() { 0.0 } else { SHAPE_WIDTH }),
                spec.height
                    .unwrap_or(if kind.is_link() { 0.0 } else { SHAPE_HEIGHT }),
            );
            if kind.is_link() {
                let (w, h) = (
                    spec.width.unwrap_or(SHAPE_WIDTH),
                    spec.height.unwrap_or(0.0),
                );
                element.insert("points".to_string(), json!([[0.0, 0.0], [w, h]]));
                element.insert("lastCommittedPoint".to_string(), Value::Null);
                element.insert("startArrowhead".to_string(), Value::Null);
                element.insert(
                    "endArrowhead".to_string(),
                    json!(if kind == ShapeKind::Arrow {
                        Some("arrow")
                    } else {
                        None
                    }),
                );
                element.insert("elbowed".to_string(), json!(false));
                for (key, end) in [("startBinding", &spec.from), ("endBinding", &spec.to)] {
                    let binding = match end {
                        Some(end) => {
                            if find(list, end).is_none() {
                                return Err(ToolError(format!(
                                    "There's no shape '{}' to connect to",
                                    end
                                )));
                            }
                            json!({ "elementId": end, "focus": 0, "gap": ARROW_GAP })
                        }
                        None => Value::Null,
                    };
                    element.insert(key.to_string(), binding);
                }
            }
            element
        };
        for (key, colour) in [
            ("strokeColor", &spec.stroke_color),
            ("backgroundColor", &spec.background_color),
        ] {
            if let Some(colour) = colour {
                element.insert(key.to_string(), json!(colour));
            }
        }
        list.push(Value::Object(element));

        if kind.is_link() {
            for end in [&spec.from, &spec.to].into_iter().flatten() {
                bind(list, end, &id, "arrow");
            }
        }
        if let Some(text) = spec.text.as_deref().filter(|_| kind != ShapeKind::Text) {
            let label = new_id();
            list.push(Value::Object(text_element(&label, text, x, y, Some(&id))));
            bind(list, &id, &label, "text");
            center_label(list, &id);
        }
        if kind.is_link() {
            route(list, &id);
        }
        added.push(id);
    }
    Ok(added)
}

/// The arrows bound to the shape `id`.
fn arrows_of(list: &[Value], id: &str) -> Vec<String> {
    find(list, id)
        .and_then(|shape| shape.get("boundElements"))
        .and_then(Value::as_array)
        .map(|bound| {
            bound
                .iter()
                .filter(|b| str_of(b, "type") == Some("arrow"))
                .filter_map(|b| str_of(b, "id").map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn update_shapes(list: &mut Vec<Value>, specs: &[ShapeSpec]) -> ToolResult<()> {
    for spec in specs {
        let id = spec
            .id
            .as_deref()
            .ok_or_else(|| ToolError("update needs each shape's id".to_string()))?;
        let element =
            find_mut(list, id).ok_or_else(|| ToolError(format!("There's no shape '{}'", id)))?;
        for (key, value) in [
            ("x", spec.x),
            ("y", spec.y),
            ("width", spec.width),
            ("height", spec.height),
        ] {
            if let Some(value) = value {
                element[key] = json!(value);
            }
        }
        for (key, colour) in [
            ("strokeColor", &spec.stroke_color),
            ("backgroundColor", &spec.background_color),
        ] {
            if let Some(colour) = colour {
                element[key] = json!(colour);
            }
        }
        let is_text = str_of(element, "type") == Some("text");
        if let (Some(text), true) = (&spec.text, is_text) {
            let (w, h) = text_size(text);
            element["text"] = json!(text);
            element["originalText"] = json!(text);
            element["width"] = json!(w);
            element["height"] = json!(h);
        }
        bump(element);

        if let (Some(text), false) = (&spec.text, is_text) {
            let label = list
                .iter()
                .position(|e| str_of(e, "containerId") == Some(id) && is_live(e));
            match label {
                Some(index) => {
                    let (w, h) = text_size(text);
                    let label = &mut list[index];
                    label["text"] = json!(text);
                    label["originalText"] = json!(text);
                    label["width"] = json!(w);
                    label["height"] = json!(h);
                    bump(label);
                }
                None => {
                    let label = new_id();
                    let (x, y, ..) = find(list, id).map(bounds).unwrap_or_default();
                    list.push(Value::Object(text_element(&label, text, x, y, Some(id))));
                    bind(list, id, &label, "text");
                }
            }
        }
        center_label(list, id);
        for arrow in arrows_of(list, id) {
            route(list, &arrow);
        }
        route(list, id);
    }
    Ok(())
}

pub(super) fn remove_shapes(list: &mut [Value], ids: &[String]) -> ToolResult<()> {
    for id in ids {
        if find(list, id).is_none() {
            return Err(ToolError(format!("There's no shape '{}'", id)));
        }
        for element in list.iter_mut() {
            let owned = str_of(element, "id") == Some(id.as_str())
                || str_of(element, "containerId") == Some(id.as_str());
            if owned && is_live(element) {
                element["isDeleted"] = json!(true);
                bump(element);
            }
        }
    }
    Ok(())
}
