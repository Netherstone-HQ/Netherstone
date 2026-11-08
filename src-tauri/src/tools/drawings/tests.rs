use super::embed::*;
use super::layout::*;
use super::scene::*;
use super::*;
use serde_json::json;

fn params(value: Value) -> EditDrawingParams {
    serde_json::from_value(value).unwrap()
}

fn create(shapes: Value) -> Map<String, Value> {
    let text = scene_after(
        None,
        &params(json!({ "path": "Flow.excalidraw", "action": "create", "shapes": shapes })),
    )
    .unwrap();
    parse(&text).unwrap()
}

fn edit(scene: &Map<String, Value>, action: &str, rest: Value) -> Map<String, Value> {
    let mut value = json!({ "path": "Flow.excalidraw", "action": action });
    for (key, field) in rest.as_object().unwrap() {
        value[key] = field.clone();
    }
    let before = serde_json::to_string(scene).unwrap();
    parse(&scene_after(Some(&before), &params(value)).unwrap()).unwrap()
}

fn element<'a>(scene: &'a mut Map<String, Value>, id: &str) -> &'a Value {
    elements(scene)
        .iter()
        .find(|e| str_of(e, "id") == Some(id))
        .unwrap()
}

fn label_of(scene: &mut Map<String, Value>, container: &str) -> Value {
    elements(scene)
        .iter()
        .find(|e| str_of(e, "containerId") == Some(container))
        .unwrap()
        .clone()
}

fn two_boxes_and_an_arrow() -> Map<String, Value> {
    create(json!([
        { "id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 50 },
        { "id": "b", "type": "rectangle", "x": 300, "y": 0, "width": 100, "height": 50 },
        { "id": "go", "type": "arrow", "from": "a", "to": "b" },
    ]))
}

// ── Embed tags ──

#[test]
fn an_embed_tag_names_its_drawing_and_leaves_the_pictures_blank() {
    assert_eq!(
        embed_tag("Diagrams/Flow.excalidraw"),
        "<img src=\"\" data-dark-src=\"\" alt=\"Flow\" width=\"480\" \
         data-excalidraw=\"Diagrams/Flow.excalidraw\" />"
    );
}

#[test]
fn an_embed_tag_escapes_the_drawing_path() {
    assert_eq!(
        embed_tag("A & \"B\" <c>.excalidraw"),
        "<img src=\"\" data-dark-src=\"\" alt=\"A &amp; &quot;B&quot; &lt;c&gt;\" \
         width=\"480\" data-excalidraw=\"A &amp; &quot;B&quot; &lt;c&gt;.excalidraw\" />"
    );
}

#[test]
fn embed_goes_at_the_end_without_a_heading() {
    let tag = embed_tag("Flow.excalidraw");
    assert_eq!(
        embedded("# Plan\n\nSome text.\n\n\n", "Flow.excalidraw", None).unwrap(),
        format!("# Plan\n\nSome text.\n\n{}\n", tag)
    );
    assert_eq!(
        embedded("", "Flow.excalidraw", None).unwrap(),
        format!("{}\n", tag)
    );
}

#[test]
fn embed_goes_under_its_heading_before_the_next() {
    let tag = embed_tag("Flow.excalidraw");
    assert_eq!(
        embedded(
            "# One\n\nFirst.\n\n# Two\n\nSecond.\n",
            "Flow.excalidraw",
            Some("## one")
        )
        .unwrap(),
        format!("# One\n\nFirst.\n\n{}\n\n# Two\n\nSecond.\n", tag)
    );
}

#[test]
fn embed_under_a_missing_heading_is_refused() {
    assert!(embedded("# One\n", "Flow.excalidraw", Some("Two")).is_err());
}

#[test]
fn filled_in_pictures_count_as_the_embed_tag() {
    let blank = format!("Text\n\n{}\n", embed_tag("Flow.excalidraw"));
    let filled = blank
        .replacen("src=\"\"", "src=\"_attachments/Flow.png\"", 1)
        .replacen(
            "data-dark-src=\"\"",
            "data-dark-src=\"_attachments/Flow-dark.png\"",
            1,
        );
    assert_ne!(blank, filled);
    assert_eq!(without_pictures(&filled), blank);
    let picture = "<img src=\"_attachments/photo.png\" />";
    assert_eq!(without_pictures(picture), picture);
}

// ── Arrow routing ──

#[test]
fn an_arrow_runs_between_the_edges_of_its_shapes() {
    let mut scene = two_boxes_and_an_arrow();
    let arrow = element(&mut scene, "go").clone();
    assert_eq!(arrow["x"], json!(106.0));
    assert_eq!(arrow["y"], json!(25.0));
    assert_eq!(arrow["width"], json!(188.0));
    assert_eq!(arrow["height"], json!(0.0));
    assert_eq!(arrow["points"], json!([[0.0, 0.0], [188.0, 0.0]]));
    assert_eq!(arrow["startBinding"]["elementId"], json!("a"));
    assert_eq!(arrow["endBinding"]["elementId"], json!("b"));
    for shape in ["a", "b"] {
        assert_eq!(
            element(&mut scene, shape)["boundElements"],
            json!([{ "id": "go", "type": "arrow" }])
        );
    }
}

#[test]
fn moving_a_shape_reroutes_its_arrows() {
    let scene = two_boxes_and_an_arrow();
    let mut scene = edit(
        &scene,
        "update",
        json!({ "shapes": [{ "id": "b", "x": 0, "y": 200 }] }),
    );
    let arrow = element(&mut scene, "go").clone();
    assert_eq!(arrow["x"], json!(50.0));
    assert_eq!(arrow["y"], json!(56.0));
    assert_eq!(arrow["points"], json!([[0.0, 0.0], [0.0, 138.0]]));
    assert_eq!(element(&mut scene, "b")["version"], json!(2));
}

#[test]
fn an_arrow_to_a_missing_shape_is_refused() {
    let result = scene_after(
        None,
        &params(json!({
            "path": "Flow.excalidraw",
            "action": "create",
            "shapes": [{ "type": "arrow", "from": "nowhere" }],
        })),
    );
    assert!(result.is_err());
}

#[test]
fn labels_sit_in_the_middle_of_shapes_and_arrows() {
    let mut scene = create(json!([
        { "id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 50, "text": "Hi" },
        { "id": "b", "type": "rectangle", "x": 300, "y": 0, "width": 100, "height": 50 },
        { "id": "go", "type": "arrow", "from": "a", "to": "b", "text": "Go" },
    ]));
    let (w, h) = text_size("Hi");
    let label = label_of(&mut scene, "a");
    assert_eq!(label["x"], json!((100.0 - w) / 2.0));
    assert_eq!(label["y"], json!((50.0 - h) / 2.0));
    let label = label_of(&mut scene, "go");
    assert_eq!(label["x"], json!((106.0 + 294.0 - w) / 2.0));
    assert_eq!(label["y"], json!((25.0 + 25.0 - h) / 2.0));
}

#[test]
fn unplaced_shapes_go_right_of_the_others() {
    let mut scene = create(json!([
        { "id": "a", "type": "rectangle", "x": 10, "y": 40, "width": 100, "height": 50 },
        { "id": "b", "type": "ellipse" },
    ]));
    let b = element(&mut scene, "b").clone();
    assert_eq!(b["x"], json!(190.0));
    assert_eq!(b["y"], json!(40.0));
    assert_eq!(b["width"], json!(SHAPE_WIDTH));
    assert_eq!(b["height"], json!(SHAPE_HEIGHT));
}

#[test]
fn removing_a_shape_marks_it_and_its_label_deleted() {
    let scene = create(json!([
        { "id": "a", "type": "rectangle", "text": "Hi" },
    ]));
    let mut scene = edit(&scene, "remove", json!({ "ids": ["a"] }));
    assert_eq!(element(&mut scene, "a")["isDeleted"], json!(true));
    assert_eq!(label_of(&mut scene, "a")["isDeleted"], json!(true));
    assert!(shapes(&mut scene).is_empty());
}

#[test]
fn reading_shows_labels_as_shape_text_and_arrow_ends() {
    let mut scene = create(json!([
        { "id": "a", "type": "rectangle", "text": "Hi" },
        { "id": "b", "type": "rectangle" },
        { "id": "go", "type": "arrow", "from": "a", "to": "b" },
    ]));
    let read = serde_json::to_value(shapes(&mut scene)).unwrap();
    let read = read.as_array().unwrap();
    assert_eq!(read.len(), 3);
    assert_eq!(read[0]["text"], json!("Hi"));
    assert_eq!(read[2]["from"], json!("a"));
    assert_eq!(read[2]["to"], json!("b"));
}
