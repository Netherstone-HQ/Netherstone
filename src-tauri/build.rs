fn main() {
    // NETHERSTONE_UPDATER=off turns the frontend's update screens off, so the
    // app must leave the updater out too (--no-default-features).
    println!("cargo:rerun-if-env-changed=NETHERSTONE_UPDATER");
    if std::env::var("NETHERSTONE_UPDATER").as_deref() == Ok("off")
        && std::env::var_os("CARGO_FEATURE_UPDATER").is_some()
    {
        panic!("NETHERSTONE_UPDATER=off needs cargo's --no-default-features as well");
    }
    write_links();
    tauri_build::build()
}

/// Every web address the app uses lives in src/data/links.json, which the
/// frontend imports too. Each one becomes a constant in `crate::links`,
/// named after its key: `githubApi` is `GITHUB_API`.
fn write_links() {
    const SOURCE: &str = "../src/data/links.json";
    println!("cargo:rerun-if-changed={SOURCE}");
    let text = std::fs::read_to_string(SOURCE).expect("src/data/links.json is missing");
    let links: std::collections::BTreeMap<String, String> =
        serde_json::from_str(&text).expect("src/data/links.json must map names to addresses");
    let mut out = String::new();
    for (key, url) in links {
        let mut name = String::new();
        for c in key.chars() {
            if c.is_ascii_uppercase() {
                name.push('_');
            }
            name.push(c.to_ascii_uppercase());
        }
        out.push_str(&format!("pub const {name}: &str = {url:?};\n"));
    }
    let dest = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("links.rs");
    std::fs::write(dest, out).expect("couldn't write the links");
}
