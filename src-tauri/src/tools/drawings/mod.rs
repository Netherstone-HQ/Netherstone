//! Reading and drawing Excalidraw drawings, and putting them in shards.
//!
//! A drawing is the JSON Excalidraw saves. Shapes are written with every
//! field Excalidraw writes, and each change bumps a shape's version, so the
//! canvas and drawing merges see it as an edit like any other. Removing a
//! shape marks it deleted, as Excalidraw does.

use super::edits::{change, edit_shard, read_text};
use super::{Caller, ToolError, ToolResult, Vault};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

mod embed;
mod layout;
mod scene;
#[cfg(test)]
mod tests;

pub(super) use embed::{embedded, without_pictures};
use layout::{add_shapes, remove_shapes, update_shapes};
use scene::{elements, is_live, num_of, parse, str_of};

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
        return Err(ToolError(format!(
            "'{}' isn't a drawing (a .excalidraw file)",
            relative
        )));
    }
    Ok(path)
}

fn shapes(scene: &mut Map<String, Value>) -> Vec<Shape> {
    let live: Vec<Value> = elements(scene)
        .iter()
        .filter(|e| is_live(e))
        .cloned()
        .collect();
    // A label is a text bound to its shape; it's shown as the shape's text.
    let label = |id: &str| {
        live.iter()
            .find(|e| str_of(e, "containerId") == Some(id))
            .and_then(|e| str_of(e, "text"))
            .map(str::to_string)
    };
    let bound = |e: &Value, key: &str| {
        e.get(key)
            .and_then(|b| b.get("elementId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    live.iter()
        .filter(|e| str_of(e, "containerId").is_none_or(str::is_empty))
        .map(|e| {
            let id = str_of(e, "id").unwrap_or_default().to_string();
            let colour = |key| {
                str_of(e, key)
                    .filter(|c| *c != "transparent")
                    .map(str::to_string)
            };
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
    Ok(paths
        .iter()
        .map(|path| vault.relative(Path::new(path)))
        .collect())
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
    pub(super) path: String,
    pub(super) action: DrawingAction,
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
    pub(super) heading: Option<String>,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    pub(super) summary: Option<String>,
}

/// The drawing `text` after `params`: a new one for create, from `text` for
/// add, update and remove. Embed changes a shard, not the drawing.
pub(super) fn scene_after(text: Option<&str>, params: &EditDrawingParams) -> ToolResult<String> {
    let shapes = params.shapes.clone().unwrap_or_default();
    let mut scene = match params.action {
        DrawingAction::Create => parse(crate::vault::EMPTY_DRAWING)?,
        _ => parse(text.ok_or_else(|| {
            ToolError(format!(
                "There's no drawing at '{}'. Use create to make one.",
                params.path
            ))
        })?)?,
    };
    let list = elements(&mut scene);
    match params.action {
        DrawingAction::Create | DrawingAction::Add => add_shapes(list, &shapes).map(|_| ())?,
        DrawingAction::Update => update_shapes(list, &shapes)?,
        DrawingAction::Remove => remove_shapes(list, params.ids.as_deref().unwrap_or_default())?,
        DrawingAction::Embed => {
            return Err(ToolError(
                "embed changes a shard, not the drawing".to_string(),
            ));
        }
    }
    serde_json::to_string_pretty(&Value::Object(scene)).map_err(|e| ToolError(e.to_string()))
}

/// What a drawing edit changes: the drawing, or for embed, the shard.
pub(super) enum DrawingTarget {
    New(PathBuf),
    Drawing(PathBuf),
    /// The shard, and the drawing's vault-relative path.
    Embed(PathBuf, String),
}

pub(super) fn target(vault: &Vault, params: &EditDrawingParams) -> ToolResult<DrawingTarget> {
    let path = drawing_path(vault, &params.path)?;
    Ok(match params.action {
        DrawingAction::Create => DrawingTarget::New(path),
        DrawingAction::Embed => {
            if !path.is_file() {
                return Err(ToolError(format!(
                    "There's no drawing at '{}'",
                    params.path
                )));
            }
            let shard = params
                .shard
                .as_deref()
                .ok_or_else(|| ToolError("embed needs the shard".to_string()))?;
            DrawingTarget::Embed(vault.shard(shard)?, vault.relative(&path))
        }
        _ => {
            if !path.is_file() {
                return Err(ToolError(format!(
                    "There's no drawing at '{}'. Use create to make one.",
                    params.path
                )));
            }
            DrawingTarget::Drawing(path)
        }
    })
}

/// Where a new drawing named for `wanted` goes: its folder, made if
/// needed, under the next free name.
pub(super) fn new_drawing_path(vault: &Vault, wanted: &Path) -> ToolResult<PathBuf> {
    let folder = wanted.parent().unwrap_or(&vault.root).to_path_buf();
    let name = wanted
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Failed to create folder {}: {}", folder.display(), e))?;
    Ok(crate::vault::unique_drawing_path(&folder, &name)?)
}

pub fn edit_drawing(
    vault: &Vault,
    caller: &Caller,
    params: EditDrawingParams,
) -> ToolResult<Drawing> {
    let summary = params.summary.as_deref();
    let path = match target(vault, &params)? {
        DrawingTarget::New(wanted) => change(vault, caller, summary, &[], || {
            let content = scene_after(None, &params)?;
            let writes = crate::locks::vault_writes()?;
            let path = new_drawing_path(vault, &wanted)?;
            crate::vault::write_atomically(&writes, &path, content.as_bytes())?;
            Ok((path.clone(), vec![path]))
        })?,
        DrawingTarget::Embed(shard, relative) => {
            change(vault, caller, summary, std::slice::from_ref(&shard), || {
                edit_shard(vault, &shard, |markdown| {
                    embedded(&markdown, &relative, params.heading.as_deref())
                })?;
                Ok(((), Vec::new()))
            })?;
            drawing_path(vault, &params.path)?
        }
        DrawingTarget::Drawing(path) => {
            change(vault, caller, summary, std::slice::from_ref(&path), || {
                let writes = crate::locks::vault_writes()?;
                let content = scene_after(Some(&read_text(&path)?), &params)?;
                crate::vault::write_atomically(&writes, &path, content.as_bytes())?;
                Ok(((), Vec::new()))
            })?;
            path
        }
    };
    read_drawing(
        vault,
        caller,
        ReadDrawingParams {
            path: vault.relative(&path),
        },
    )
}
