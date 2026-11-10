//! Attachments: files shards link to, kept in the vault's `_attachments`
//! folder.

pub mod cleanup;
pub mod commands;
pub mod drawing_pictures;
pub mod policy;
pub mod references;
pub mod report;
pub mod store;

#[cfg(test)]
mod tests;
