//! Merging two versions of a drawing shape by shape: by sync, when a drawing
//! changed on two devices, and by the canvas, when the open drawing changed
//! outside the app.
//!
//! A shape changed when its `version` or `versionNonce` did, which Excalidraw
//! bumps on every edit. Shapes changed on one side only take that side's
//! version. A shape changed on both sides is a conflict: ours is kept.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergedDrawing {
    pub content: String,
    /// A shape changed on both sides; ours was kept.
    pub conflicted: bool,
}

/// Merges `ours` and `theirs`, two versions of the drawing `base`. None when
/// one of them isn't a drawing.
pub fn merge(base: &str, ours: &str, theirs: &str) -> Option<MergedDrawing> {
    let (base, mut ours, theirs) = (parse(base)?, parse(ours)?, parse(theirs)?);
    let base_shapes = shapes_by_id(&base);
    let their_shapes = shapes_by_id(&theirs);
    let mut conflicted = false;

    let mut merged: Vec<Value> = Vec::new();
    for shape in elements(&ours) {
        let Some(id) = shape_id(shape) else {
            merged.push(shape.clone());
            continue;
        };
        let (kept, conflict) = pick(
            base_shapes.get(id).copied(),
            Some(shape),
            their_shapes.get(id).copied(),
        );
        conflicted |= conflict;
        merged.extend(kept.cloned());
    }

    // Shapes only they have go after the shape they follow on their side.
    let our_ids: HashSet<&str> = elements(&ours).iter().filter_map(shape_id).collect();
    let mut cursor = 0;
    for shape in elements(&theirs) {
        let Some(id) = shape_id(shape) else { continue };
        if our_ids.contains(id) {
            if let Some(index) = merged.iter().position(|m| shape_id(m) == Some(id)) {
                cursor = index + 1;
            }
            continue;
        }
        let (kept, conflict) = pick(base_shapes.get(id).copied(), None, Some(shape));
        conflicted |= conflict;
        if let Some(kept) = kept {
            merged.insert(cursor, kept.clone());
            cursor += 1;
        }
    }

    let files = merge_files(&ours, &theirs, &merged);
    let app_state = merge_app_state(&base, &ours, &theirs);
    ours.insert("elements".into(), Value::Array(merged));
    if let Some(files) = files {
        ours.insert("files".into(), Value::Object(files));
    }
    if let Some(app_state) = app_state {
        ours.insert("appState".into(), Value::Object(app_state));
    }

    let content = serde_json::to_string_pretty(&Value::Object(ours)).ok()?;
    Some(MergedDrawing {
        content,
        conflicted,
    })
}

/// A drawing's top-level object. An empty file is an empty drawing.
fn parse(json: &str) -> Option<Map<String, Value>> {
    if json.trim().is_empty() {
        return Some(Map::new());
    }
    match serde_json::from_str(json).ok()? {
        Value::Object(object) => Some(object),
        _ => None,
    }
}

fn elements(drawing: &Map<String, Value>) -> &[Value] {
    drawing
        .get("elements")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn shape_id(shape: &Value) -> Option<&str> {
    shape.get("id").and_then(Value::as_str)
}

fn shapes_by_id(drawing: &Map<String, Value>) -> HashMap<&str, &Value> {
    elements(drawing)
        .iter()
        .filter_map(|shape| Some((shape_id(shape)?, shape)))
        .collect()
}

/// What tells one edit of a shape from another, with Excalidraw's defaults
/// for a shape that has none.
fn stamp(shape: &Value) -> (i64, i64) {
    let number = |key| shape.get(key).and_then(Value::as_i64);
    (
        number("version").filter(|v| *v != 0).unwrap_or(1),
        number("versionNonce").unwrap_or(0),
    )
}

fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => stamp(a) == stamp(b),
        _ => false,
    }
}

/// One shape's version to keep (None: removed), and whether it changed on
/// both sides.
fn pick<'a>(
    base: Option<&'a Value>,
    ours: Option<&'a Value>,
    theirs: Option<&'a Value>,
) -> (Option<&'a Value>, bool) {
    if same(ours, theirs) || same(theirs, base) {
        (ours, false)
    } else if same(ours, base) {
        (theirs, false)
    } else {
        (ours, true)
    }
}

/// Pictures used by the merged shapes, ours first. None when neither side
/// has any.
fn merge_files(
    ours: &Map<String, Value>,
    theirs: &Map<String, Value>,
    merged: &[Value],
) -> Option<Map<String, Value>> {
    let files_of =
        |drawing: &Map<String, Value>| drawing.get("files").and_then(Value::as_object).cloned();
    let (our_files, their_files) = (files_of(ours), files_of(theirs));
    if our_files.is_none() && their_files.is_none() {
        return None;
    }
    let used: HashSet<&str> = merged
        .iter()
        .filter_map(|shape| shape.get("fileId").and_then(Value::as_str))
        .collect();
    let mut files = our_files.unwrap_or_default();
    for (id, file) in their_files.unwrap_or_default() {
        files.entry(id).or_insert(file);
    }
    files.retain(|id, _| used.contains(id.as_str()));
    Some(files)
}

/// Canvas settings (background, grid) merged one by one: theirs where only
/// they changed it.
fn merge_app_state(
    base: &Map<String, Value>,
    ours: &Map<String, Value>,
    theirs: &Map<String, Value>,
) -> Option<Map<String, Value>> {
    let state_of =
        |drawing: &Map<String, Value>| drawing.get("appState").and_then(Value::as_object).cloned();
    let (base, theirs) = (state_of(base).unwrap_or_default(), state_of(theirs)?);
    let mut merged = state_of(ours).unwrap_or_default();
    let keys: HashSet<String> = base.keys().chain(theirs.keys()).cloned().collect();
    for key in keys {
        if merged.get(&key) != base.get(&key) {
            continue;
        }
        match theirs.get(&key) {
            Some(value) => merged.insert(key, value.clone()),
            None => merged.remove(&key),
        };
    }
    Some(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shape(id: &str, version: i64, x: i64) -> Value {
        json!({ "id": id, "type": "rectangle", "version": version, "versionNonce": version * 10, "x": x })
    }

    fn drawing(shapes: Vec<Value>) -> String {
        json!({ "type": "excalidraw", "elements": shapes, "appState": { "viewBackgroundColor": "#ffffff" } })
            .to_string()
    }

    fn merged(base: Vec<Value>, ours: Vec<Value>, theirs: Vec<Value>) -> (Vec<Value>, bool) {
        let result = merge(&drawing(base), &drawing(ours), &drawing(theirs)).unwrap();
        let value: Value = serde_json::from_str(&result.content).unwrap();
        (
            value["elements"].as_array().unwrap().clone(),
            result.conflicted,
        )
    }

    #[test]
    fn keeps_shapes_added_on_both_sides_in_place() {
        let a = shape("a", 1, 0);
        let (shapes, conflicted) = merged(
            vec![a.clone()],
            vec![a.clone(), shape("ours", 1, 1)],
            vec![shape("before", 1, 2), a.clone(), shape("theirs", 1, 3)],
        );
        let ids: Vec<_> = shapes.iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["before", "a", "theirs", "ours"]);
        assert!(!conflicted);
    }

    #[test]
    fn takes_each_sides_edits_and_removals() {
        let (a, b, c) = (shape("a", 1, 0), shape("b", 1, 0), shape("c", 1, 0));
        let (shapes, conflicted) = merged(
            vec![a.clone(), b.clone(), c.clone()],
            vec![shape("a", 2, 5), b.clone()],
            vec![a.clone(), shape("b", 2, 7), c.clone()],
        );
        assert_eq!(shapes, vec![shape("a", 2, 5), shape("b", 2, 7)]);
        assert!(!conflicted);
    }

    #[test]
    fn a_shape_changed_on_both_sides_keeps_ours() {
        let a = shape("a", 1, 0);
        let (shapes, conflicted) = merged(
            vec![a.clone()],
            vec![shape("a", 2, 5)],
            vec![shape("a", 3, 9)],
        );
        assert_eq!(shapes, vec![shape("a", 2, 5)]);
        assert!(conflicted);

        // Removed here, edited there.
        let (shapes, conflicted) = merged(vec![a.clone()], vec![], vec![shape("a", 2, 9)]);
        assert!(shapes.is_empty());
        assert!(conflicted);
    }

    #[test]
    fn the_same_edit_on_both_sides_is_no_conflict() {
        let (shapes, conflicted) = merged(
            vec![shape("a", 1, 0)],
            vec![shape("a", 2, 5)],
            vec![shape("a", 2, 5)],
        );
        assert_eq!(shapes, vec![shape("a", 2, 5)]);
        assert!(!conflicted);
    }

    #[test]
    fn merges_pictures_and_canvas_settings() {
        let picture = |id: &str| json!({ "id": id, "type": "image", "version": 1, "fileId": format!("f-{id}") });
        let file = |id: &str| json!({ "id": format!("f-{id}"), "dataURL": "data:," });
        let base = json!({ "elements": [picture("old")], "files": { "f-old": file("old") },
            "appState": { "viewBackgroundColor": "#fff", "gridSize": 20 } });
        let ours = json!({ "elements": [], "files": {},
            "appState": { "viewBackgroundColor": "#fff", "gridSize": 10 } });
        let theirs = json!({ "elements": [picture("old"), picture("new")],
            "files": { "f-old": file("old"), "f-new": file("new") },
            "appState": { "viewBackgroundColor": "#000", "gridSize": 20 } });

        let result = merge(&base.to_string(), &ours.to_string(), &theirs.to_string()).unwrap();
        let value: Value = serde_json::from_str(&result.content).unwrap();
        assert_eq!(value["files"], json!({ "f-new": file("new") }));
        assert_eq!(
            value["appState"],
            json!({ "viewBackgroundColor": "#000", "gridSize": 10 })
        );
    }

    #[test]
    fn refuses_what_isnt_a_drawing() {
        assert!(merge("", &drawing(vec![]), "[1, 2]").is_none());
        assert!(merge("", &drawing(vec![]), "{ \"elements\": [").is_none());
        assert!(merge("", "", &drawing(vec![shape("a", 1, 0)])).is_some());
    }
}
