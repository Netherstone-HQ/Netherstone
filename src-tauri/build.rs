fn main() {
    // NETHERSTONE_UPDATER=off turns the frontend's update screens off, so the
    // app must leave the updater out too (--no-default-features).
    println!("cargo:rerun-if-env-changed=NETHERSTONE_UPDATER");
    if std::env::var("NETHERSTONE_UPDATER").as_deref() == Ok("off")
        && std::env::var_os("CARGO_FEATURE_UPDATER").is_some()
    {
        panic!("NETHERSTONE_UPDATER=off needs cargo's --no-default-features as well");
    }
    tauri_build::build()
}
