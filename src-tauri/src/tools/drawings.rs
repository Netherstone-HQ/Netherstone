//! Reading and drawing Excalidraw drawings, and putting them in shards.
//!
//! A drawing is the JSON Excalidraw saves. Shapes are written with every
//! field Excalidraw writes, and each change bumps a shape's version, so the
//! canvas and drawing merges see it as an edit like any other. Removing a
//! shape marks it deleted, as Excalidraw does.

use super::edits::{change, edit_shard, read_text};
use super::read::find_section;
use super::{Caller, ToolError, ToolResult, Vault};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};

// ── Reading ──────────────────────────────────────────────────────────────────

pub const READ_DRAWING: &str = "Read an Excalidraw drawing (.excalidraw) as a list of \
its shapes: each one's id, type, place and size, its text, and for arrows the \
shapes they connect. Also lists the shards the drawing is shown in.";

#[derive(Deserialize, JsonSchema)]
pub struct ReadDrawingParams {
    /// The drawing, vault-relative, like Diagrams/Flow.excalidraw.
    path: String,
}

#[derive(Serialize)]
pub struct Shape {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    x: i64,
    y: i64,
    width: i64,
    height: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stroke_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    background_color: Option<String>,
}

#[derive(Serialize)]
pub struct Drawing {
    path: String,
    shapes: Vec<Shape>,
    shown_in: Vec<String>,
}

fn drawing_path(vault: &Vault, relative: &str) -> ToolResult<PathBuf> {
    let path = vault.resolve(relative)?;
    if !crate::vault::is_drawing_path(&path) {
        return Err(ToolError(format!("'{}' isn't a drawing (a .excalidraw file)", relative)));
    }
    Ok(path)
}

fn parse(content: &str) -> ToolResult<Map<String, Value>> {
    match serde_json::from_str(content) {
        Ok(Value::Object(scene)) => Ok(scene),
        _ => Err(ToolError("The file isn't an Excalidraw drawing".to_string())),
    }
}

fn elements(scene: &mut Map<String, Value>) -> &mut Vec<Value> {
    if !scene.get("elements").is_some_and(Value::is_array) {
        scene.insert("elements".to_string(), Value::Array(Vec::new()));
    }
    scene.get_mut("elements").and_then(Value::as_array_mut).expect("just made an array")
}

fn is_live(element: &Value) -> bool {
    !element.get("isDeleted").and_then(Value::as_bool).unwrap_or(false)
}

fn str_of<'a>(element: &'a Value, key: &str) -> Option<&'a str> {
    element.get(key).and_then(Value::as_str)
}

fn num_of(element: &Value, key: &str) -> f64 {
    element.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn shapes(scene: &mut Map<String, Value>) -> Vec<Shape> {
    let live: Vec<Value> = elements(scene).iter().filter(|e| is_live(e)).cloned().collect();
    // A label is a text bound to its shape; it's shown as the shape's text.
    let label = |id: &str| {
        live.iter()
            .find(|e| str_of(e, "containerId") == Some(id))
            .and_then(|e| str_of(e, "text"))
            .map(str::to_string)
    };
    let bound = |e: &Value, key: &str| {
        e.get(key).and_then(|b| b.get("elementId")).and_then(Value::as_str).map(str::to_string)
    };
    live.iter()
        .filter(|e| str_of(e, "containerId").is_none_or(str::is_empty))
        .map(|e| {
            let id = str_of(e, "id").unwrap_or_default().to_string();
            let colour = |key| str_of(e, key).filter(|c| *c != "transparent").map(str::to_string);
            Shape {
                text: str_of(e, "text").map(str::to_string).or_else(|| label(&id)),
                kind: str_of(e, "type").unwrap_or_default().to_string(),
                x: num_of(e, "x").round() as i64,
                y: num_of(e, "y").round() as i64,
                width: num_of(e, "width").round() as i64,
                height: num_of(e, "height").round() as i64,
                from: bound(e, "startBinding"),
                to: bound(e, "endBinding"),
                stroke_color: colour("strokeColor"),
                background_color: colour("backgroundColor"),
                id,
            }
        })
        .collect()
}

fn shown_in(vault: &Vault, relative: &str) -> ToolResult<Vec<String>> {
    let conn = vault.index()?;
    let mut stmt = conn.prepare(
        "SELECT f.path FROM drawing_embeds d JOIN files f ON f.id = d.file_id
         WHERE d.drawing_path = ?2 AND f.vault_path = ?1
         ORDER BY f.path",
    )?;
    let paths = stmt
        .query_map(
            rusqlite::params![crate::db::attachments::vault_key(&vault.root), relative],
            |row| row.get::<_, String>(0),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(paths.iter().map(|path| vault.relative(Path::new(path))).collect())
}

pub fn read_drawing(vault: &Vault, _: &Caller, params: ReadDrawingParams) -> ToolResult<Drawing> {
    let path = drawing_path(vault, &params.path)?;
    let mut scene = parse(&read_text(&path)?)?;
    let relative = vault.relative(&path);
    Ok(Drawing {
        shapes: shapes(&mut scene),
        shown_in: shown_in(vault, &relative)?,
        path: relative,
    })
}

// ── Drawing ──────────────────────────────────────────────────────────────────

pub const EDIT_DRAWING: &str = "Make or change an Excalidraw drawing, to draw a \
diagram. create makes a new drawing (path is where it goes, like \
Diagrams/Flow.excalidraw) with any shapes given. add adds shapes, update \
changes shapes by id (only the fields given), remove takes shapes out by id. \
Shapes are rectangle, ellipse, diamond, text, arrow or line. Give a shape \
text to label it, and give an arrow from and to (shape ids) to connect them: \
it's drawn between them. A shape without x and y goes right of the others. \
New shapes can name their own id, so arrows can connect them in the same \
call. embed shows the drawing in a shard, under a heading or at the end; \
Netherstone makes its picture when the shard is next opened.";

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DrawingAction {
    Create,
    Add,
    Update,
    Remove,
    Embed,
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    Diamond,
    Text,
    Arrow,
    Line,
}

impl ShapeKind {
    fn name(self) -> &'static str {
        match self {
            ShapeKind::Rectangle => "rectangle",
            ShapeKind::Ellipse => "ellipse",
            ShapeKind::Diamond => "diamond",
            ShapeKind::Text => "text",
            ShapeKind::Arrow => "arrow",
            ShapeKind::Line => "line",
        }
    }

    fn is_link(self) -> bool {
        matches!(self, ShapeKind::Arrow | ShapeKind::Line)
    }
}

#[derive(Deserialize, JsonSchema, Clone)]
pub struct ShapeSpec {
    /// For update: which shape. For new shapes: an id of your own to connect
    /// arrows to (one is made if left out).
    #[serde(default)]
    id: Option<String>,
    /// Needed for new shapes.
    #[serde(default, rename = "type")]
    kind: Option<ShapeKind>,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
    /// A text shape's text, or the label in a shape or on an arrow.
    #[serde(default)]
    text: Option<String>,
    /// For an arrow or line: the id of the shape it starts at.
    #[serde(default)]
    from: Option<String>,
    /// For an arrow or line: the id of the shape it ends at.
    #[serde(default)]
    to: Option<String>,
    /// A color like #1971c2.
    #[serde(default)]
    stroke_color: Option<String>,
    /// A fill color like #a5d8ff.
    #[serde(default)]
    background_color: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct EditDrawingParams {
    /// The drawing, vault-relative. For create, where the new one goes.
    path: String,
    action: DrawingAction,
    /// For create, add and update.
    #[serde(default)]
    shapes: Option<Vec<ShapeSpec>>,
    /// For remove: the ids of the shapes to take out.
    #[serde(default)]
    ids: Option<Vec<String>>,
    /// For embed: the shard to show it in, vault-relative.
    #[serde(default)]
    shard: Option<String>,
    /// For embed: the heading to show it under. Leave out for the end.
    #[serde(default)]
    heading: Option<String>,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

/// Excalidraw's look for new shapes, as the canvas starts them.
const STROKE: &str = "#1e1e1e";
const FONT_SIZE: f64 = 20.0;
const LINE_HEIGHT: f64 = 1.25;
/// Excalifont, the hand-drawn font Excalidraw draws text in.
const FONT_FAMILY: i64 = 5;
/// Roughly how wide a character of it is, for sizing text before the canvas
/// measures it.
const CHARACTER_WIDTH: f64 = 0.55;
/// The size of a shape given none, and the gap left between shapes.
const SHAPE_WIDTH: f64 = 180.0;
const SHAPE_HEIGHT: f64 = 80.0;
const SHAPE_GAP: f64 = 80.0;
/// How far an arrow stops from the shapes it connects.
const ARROW_GAP: f64 = 6.0;
/// Width of a drawing's picture in a shard, as the app embeds it.
const EMBED_WIDTH: &str = "480";

fn random() -> u64 {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    hasher.finish()
}

fn new_id() -> String {
    const LETTERS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let (mut value, mut extra) = (random(), random());
    (0..20)
        .map(|_| {
            if value == 0 {
                value = std::mem::take(&mut extra).max(1);
            }
            let letter = LETTERS[(value % LETTERS.len() as u64) as usize] as char;
            value /= LETTERS.len() as u64;
            letter
        })
        .collect()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// The fields every Excalidraw element has.
fn base(id: &str, kind: &str, x: f64, y: f64, width: f64, height: f64) -> Map<String, Value> {
    let rounded = matches!(kind, "rectangle" | "diamond" | "arrow" | "line");
    let Value::Object(element) = json!({
        "id": id,
        "type": kind,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "angle": 0,
        "strokeColor": STROKE,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": null,
        "roundness": if rounded { json!({ "type": if kind == "rectangle" { 3 } else { 2 } }) } else { Value::Null },
        "seed": random() as u32,
        "version": 1,
        "versionNonce": random() as u32,
        "isDeleted": false,
        "boundElements": [],
        "updated": now_millis(),
        "link": null,
        "locked": false,
    }) else {
        unreachable!("an object")
    };
    element
}

/// The size of `text` in the drawing's font.
fn text_size(text: &str) -> (f64, f64) {
    let lines: Vec<&str> = text.lines().collect();
    let longest = lines.iter().map(|line| line.chars().count()).max().unwrap_or(0) as f64;
    (longest * FONT_SIZE * CHARACTER_WIDTH, lines.len().max(1) as f64 * FONT_SIZE * LINE_HEIGHT)
}

fn text_element(id: &str, text: &str, x: f64, y: f64, container: Option<&str>) -> Map<String, Value> {
    let (width, height) = text_size(text);
    let mut element = base(id, "text", x, y, width, height);
    element.insert("roundness".to_string(), Value::Null);
    for (key, value) in [
        ("text", json!(text)),
        ("originalText", json!(text)),
        ("fontSize", json!(FONT_SIZE)),
        ("fontFamily", json!(FONT_FAMILY)),
        ("textAlign", json!(if container.is_some() { "center" } else { "left" })),
        ("verticalAlign", json!(if container.is_some() { "middle" } else { "top" })),
        ("containerId", json!(container)),
        ("autoResize", json!(true)),
        ("lineHeight", json!(LINE_HEIGHT)),
    ] {
        element.insert(key.to_string(), value);
    }
    element
}

/// The box a shape takes up.
fn bounds(element: &Value) -> (f64, f64, f64, f64) {
    (num_of(element, "x"), num_of(element, "y"), num_of(element, "width"), num_of(element, "height"))
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

fn find<'a>(list: &'a [Value], id: &str) -> Option<&'a Value> {
    list.iter().find(|e| str_of(e, "id") == Some(id) && is_live(e))
}

fn find_mut<'a>(list: &'a mut [Value], id: &str) -> Option<&'a mut Value> {
    list.iter_mut().find(|e| str_of(e, "id") == Some(id) && is_live(e))
}

/// Notes `bound` (an arrow or label) on the shape `id`, so moving the shape
/// takes it along.
fn bind(list: &mut [Value], id: &str, bound: &str, kind: &str) {
    if let Some(shape) = find_mut(list, id) {
        let entry = json!({ "id": bound, "type": kind });
        match shape.get_mut("boundElements").and_then(Value::as_array_mut) {
            Some(list) if !list.contains(&entry) => list.push(entry),
            Some(_) => {}
            None => {
                shape["boundElements"] = json!([entry]);
            }
        }
    }
}

/// Marks `element` as edited, as the canvas does on every change.
fn bump(element: &mut Value) {
    let version = element.get("version").and_then(Value::as_i64).unwrap_or(0);
    element["version"] = json!(version + 1);
    element["versionNonce"] = json!(random() as u32);
    element["updated"] = json!(now_millis());
}

/// Puts a label's text in the middle of its shape.
fn center_label(list: &mut [Value], container: &str) {
    let Some(shape) = find(list, container).map(bounds) else { return };
    if let Some(label) = list.iter_mut().find(|e| str_of(e, "containerId") == Some(container) && is_live(e)) {
        let (w, h) = (num_of(label, "width"), num_of(label, "height"));
        label["x"] = json!(shape.0 + (shape.2 - w) / 2.0);
        label["y"] = json!(shape.1 + (shape.3 - h) / 2.0);
    }
}

/// Lays an arrow between the shapes it connects.
fn route(list: &mut [Value], arrow: &str) {
    let Some(element) = find(list, arrow) else { return };
    let end = |key: &str| element.get(key).and_then(|b| b.get("elementId")).and_then(Value::as_str).map(str::to_string);
    let (Some(start), Some(end)) = (end("startBinding"), end("endBinding")) else { return };
    let (Some(a), Some(b)) = (find(list, &start).map(bounds), find(list, &end).map(bounds)) else { return };
    let middle = |r: (f64, f64, f64, f64)| (r.0 + r.2 / 2.0, r.1 + r.3 / 2.0);
    let from = edge_point(a, middle(b));
    let to = edge_point(b, middle(a));
    if let Some(element) = find_mut(list, arrow) {
        element["x"] = json!(from.0);
        element["y"] = json!(from.1);
        element["width"] = json!((to.0 - from.0).abs());
        element["height"] = json!((to.1 - from.1).abs());
        element["points"] = json!([[0.0, 0.0], [to.0 - from.0, to.1 - from.1]]);
    }
    if let Some(label) = list.iter().find(|e| str_of(e, "containerId") == Some(arrow) && is_live(e)) {
        let id = str_of(label, "id").unwrap_or_default().to_string();
        let (w, h) = (num_of(label, "width"), num_of(label, "height"));
        if let Some(label) = find_mut(list, &id) {
            label["x"] = json!((from.0 + to.0 - w) / 2.0);
            label["y"] = json!((from.1 + to.1 - h) / 2.0);
        }
    }
}

fn add_shapes(list: &mut Vec<Value>, specs: &[ShapeSpec]) -> ToolResult<Vec<String>> {
    let mut added = Vec::new();
    for spec in specs {
        let kind = spec.kind.ok_or_else(|| ToolError("A new shape needs a type".to_string()))?;
        let id = spec.id.clone().filter(|id| !id.trim().is_empty()).unwrap_or_else(new_id);
        if list.iter().any(|e| str_of(e, "id") == Some(id.as_str())) {
            return Err(ToolError(format!("The drawing already has a shape with id '{}'", id)));
        }
        // Right of everything else, on the top row, unless placed.
        let right = list.iter().filter(|e| is_live(e)).map(|e| num_of(e, "x") + num_of(e, "width")).fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.max(r))));
        let top = list.iter().filter(|e| is_live(e)).map(|e| num_of(e, "y")).fold(None, |m: Option<f64>, t| Some(m.map_or(t, |m| m.min(t))));
        let x = spec.x.unwrap_or_else(|| right.map_or(0.0, |r| r + SHAPE_GAP));
        let y = spec.y.unwrap_or_else(|| top.unwrap_or(0.0));

        let mut element = if kind == ShapeKind::Text {
            text_element(&id, spec.text.as_deref().unwrap_or(""), x, y, None)
        } else {
            let mut element = base(
                &id,
                kind.name(),
                x,
                y,
                spec.width.unwrap_or(if kind.is_link() { 0.0 } else { SHAPE_WIDTH }),
                spec.height.unwrap_or(if kind.is_link() { 0.0 } else { SHAPE_HEIGHT }),
            );
            if kind.is_link() {
                let (w, h) = (spec.width.unwrap_or(SHAPE_WIDTH), spec.height.unwrap_or(0.0));
                element.insert("points".to_string(), json!([[0.0, 0.0], [w, h]]));
                element.insert("lastCommittedPoint".to_string(), Value::Null);
                element.insert("startArrowhead".to_string(), Value::Null);
                element.insert("endArrowhead".to_string(), json!(if kind == ShapeKind::Arrow { Some("arrow") } else { None }));
                element.insert("elbowed".to_string(), json!(false));
                for (key, end) in [("startBinding", &spec.from), ("endBinding", &spec.to)] {
                    let binding = match end {
                        Some(end) => {
                            if find(list, end).is_none() {
                                return Err(ToolError(format!("There's no shape '{}' to connect to", end)));
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
        for (key, colour) in [("strokeColor", &spec.stroke_color), ("backgroundColor", &spec.background_color)] {
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

fn update_shapes(list: &mut Vec<Value>, specs: &[ShapeSpec]) -> ToolResult<()> {
    for spec in specs {
        let id = spec.id.as_deref().ok_or_else(|| ToolError("update needs each shape's id".to_string()))?;
        let element = find_mut(list, id).ok_or_else(|| ToolError(format!("There's no shape '{}'", id)))?;
        for (key, value) in [("x", spec.x), ("y", spec.y), ("width", spec.width), ("height", spec.height)] {
            if let Some(value) = value {
                element[key] = json!(value);
            }
        }
        for (key, colour) in [("strokeColor", &spec.stroke_color), ("backgroundColor", &spec.background_color)] {
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
            let label = list.iter().position(|e| str_of(e, "containerId") == Some(id) && is_live(e));
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

fn remove_shapes(list: &mut [Value], ids: &[String]) -> ToolResult<()> {
    for id in ids {
        if find(list, id).is_none() {
            return Err(ToolError(format!("There's no shape '{}'", id)));
        }
        for element in list.iter_mut() {
            let owned = str_of(element, "id") == Some(id.as_str()) || str_of(element, "containerId") == Some(id.as_str());
            if owned && is_live(element) {
                element["isDeleted"] = json!(true);
                bump(element);
            }
        }
    }
    Ok(())
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The image tag the app writes for a drawing in a shard, without its
/// pictures yet: the app exports them when the shard is next opened.
fn embed_tag(relative: &str) -> String {
    let name = Path::new(relative).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "<img src=\"\" data-dark-src=\"\" alt=\"{}\" width=\"{}\" data-excalidraw=\"{}\" />",
        escape_attribute(&name),
        EMBED_WIDTH,
        escape_attribute(relative)
    )
}

/// Reads the drawing at `path`, changes it with `edit` and writes it back
/// under one lock, so no save of the canvas lands in between and is lost.
fn edit_scene(path: &Path, edit: impl FnOnce(&mut Vec<Value>) -> ToolResult<()>) -> ToolResult<()> {
    let writes = crate::locks::vault_writes()?;
    let mut scene = parse(&read_text(path)?)?;
    edit(elements(&mut scene))?;
    let content = serde_json::to_string_pretty(&Value::Object(scene)).map_err(|e| ToolError(e.to_string()))?;
    Ok(crate::vault::write_atomically(&writes, path, content.as_bytes())?)
}

pub fn edit_drawing(vault: &Vault, caller: &Caller, params: EditDrawingParams) -> ToolResult<Drawing> {
    let path = drawing_path(vault, &params.path)?;
    let summary = params.summary.as_deref();
    let shapes_given = || params.shapes.clone().unwrap_or_default();

    let path = match params.action {
        DrawingAction::Create => {
            let folder = path.parent().unwrap_or(&vault.root).to_path_buf();
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            change(vault, caller, summary, &[], || {
                let writes = crate::locks::vault_writes()?;
                std::fs::create_dir_all(&folder).map_err(|e| format!("Failed to create folder {}: {}", folder.display(), e))?;
                let path = crate::vault::unique_drawing_path(&folder, &name)?;
                let mut scene = parse(crate::vault::EMPTY_DRAWING)?;
                add_shapes(elements(&mut scene), &shapes_given())?;
                let content = serde_json::to_string_pretty(&Value::Object(scene)).map_err(|e| ToolError(e.to_string()))?;
                crate::vault::write_atomically(&writes, &path, content.as_bytes())?;
                Ok((path.clone(), vec![path]))
            })?
        }
        DrawingAction::Embed => {
            if !path.is_file() {
                return Err(ToolError(format!("There's no drawing at '{}'", params.path)));
            }
            let shard_relative = params.shard.as_deref().ok_or_else(|| ToolError("embed needs the shard".to_string()))?;
            let shard = vault.shard(shard_relative)?;
            let tag = embed_tag(&vault.relative(&path));
            change(vault, caller, summary, &[shard.clone()], || {
                edit_shard(vault, &shard, |markdown| {
                    let at = match &params.heading {
                        Some(heading) => find_section(&markdown, heading)?.range.end,
                        None => markdown.len(),
                    };
                    let (before, after) = markdown.split_at(at);
                    let before = before.trim_end_matches(['\n', '\r', ' ']);
                    let gap = if before.is_empty() { "" } else { "\n\n" };
                    let rest = after.trim_start_matches(['\n', '\r']);
                    let tail = if rest.is_empty() { String::new() } else { format!("\n{}", rest) };
                    Ok(format!("{}{}{}\n{}", before, gap, tag, tail))
                })?;
                Ok(((), Vec::new()))
            })?;
            path
        }
        action => {
            if !path.is_file() {
                return Err(ToolError(format!("There's no drawing at '{}'. Use create to make one.", params.path)));
            }
            change(vault, caller, summary, &[path.clone()], || {
                edit_scene(&path, |list| match action {
                    DrawingAction::Add => add_shapes(list, &shapes_given()).map(|_| ()),
                    DrawingAction::Update => update_shapes(list, &shapes_given()),
                    DrawingAction::Remove => remove_shapes(list, params.ids.as_deref().unwrap_or_default()),
                    DrawingAction::Create | DrawingAction::Embed => unreachable!("handled above"),
                })?;
                Ok(((), Vec::new()))
            })?;
            path
        }
    };
    read_drawing(vault, caller, ReadDrawingParams { path: vault.relative(&path) })
}
