//! The Excalidraw format: reading a drawing's elements and making new ones
//! the way the canvas does.

use super::super::{ToolError, ToolResult};
use serde_json::{Map, Value, json};
use std::hash::{BuildHasher, Hasher};

pub(super) fn parse(content: &str) -> ToolResult<Map<String, Value>> {
    match serde_json::from_str(content) {
        Ok(Value::Object(scene)) => Ok(scene),
        _ => Err(ToolError(
            "The file isn't an Excalidraw drawing".to_string(),
        )),
    }
}

pub(super) fn elements(scene: &mut Map<String, Value>) -> &mut Vec<Value> {
    if !scene.get("elements").is_some_and(Value::is_array) {
        scene.insert("elements".to_string(), Value::Array(Vec::new()));
    }
    scene
        .get_mut("elements")
        .and_then(Value::as_array_mut)
        .expect("just made an array")
}

pub(super) fn is_live(element: &Value) -> bool {
    !element
        .get("isDeleted")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn str_of<'a>(element: &'a Value, key: &str) -> Option<&'a str> {
    element.get(key).and_then(Value::as_str)
}

pub(super) fn num_of(element: &Value, key: &str) -> f64 {
    element.get(key).and_then(Value::as_f64).unwrap_or(0.0)
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

fn random() -> u64 {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    hasher.finish()
}

pub(super) fn new_id() -> String {
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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The fields every Excalidraw element has.
pub(super) fn base(
    id: &str,
    kind: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Map<String, Value> {
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
pub(super) fn text_size(text: &str) -> (f64, f64) {
    let lines: Vec<&str> = text.lines().collect();
    let longest = lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0) as f64;
    (
        longest * FONT_SIZE * CHARACTER_WIDTH,
        lines.len().max(1) as f64 * FONT_SIZE * LINE_HEIGHT,
    )
}

pub(super) fn text_element(
    id: &str,
    text: &str,
    x: f64,
    y: f64,
    container: Option<&str>,
) -> Map<String, Value> {
    let (width, height) = text_size(text);
    let mut element = base(id, "text", x, y, width, height);
    element.insert("roundness".to_string(), Value::Null);
    for (key, value) in [
        ("text", json!(text)),
        ("originalText", json!(text)),
        ("fontSize", json!(FONT_SIZE)),
        ("fontFamily", json!(FONT_FAMILY)),
        (
            "textAlign",
            json!(if container.is_some() {
                "center"
            } else {
                "left"
            }),
        ),
        (
            "verticalAlign",
            json!(if container.is_some() { "middle" } else { "top" }),
        ),
        ("containerId", json!(container)),
        ("autoResize", json!(true)),
        ("lineHeight", json!(LINE_HEIGHT)),
    ] {
        element.insert(key.to_string(), value);
    }
    element
}

pub(super) fn find<'a>(list: &'a [Value], id: &str) -> Option<&'a Value> {
    list.iter()
        .find(|e| str_of(e, "id") == Some(id) && is_live(e))
}

pub(super) fn find_mut<'a>(list: &'a mut [Value], id: &str) -> Option<&'a mut Value> {
    list.iter_mut()
        .find(|e| str_of(e, "id") == Some(id) && is_live(e))
}

/// Notes `bound` (an arrow or label) on the shape `id`, so moving the shape
/// takes it along.
pub(super) fn bind(list: &mut [Value], id: &str, bound: &str, kind: &str) {
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
pub(super) fn bump(element: &mut Value) {
    let version = element.get("version").and_then(Value::as_i64).unwrap_or(0);
    element["version"] = json!(version + 1);
    element["versionNonce"] = json!(random() as u32);
    element["updated"] = json!(now_millis());
}
