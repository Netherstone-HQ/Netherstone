//! The web addresses the app uses, made from src/data/links.json by
//! build.rs. Some are only for the frontend.
#![allow(dead_code)]

include!(concat!(env!("OUT_DIR"), "/links.rs"));
