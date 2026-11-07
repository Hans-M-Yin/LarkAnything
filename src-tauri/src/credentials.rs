//! Secrets stay in the OS credential store, never in JSON or IPC responses.
use crate::{failure, Result};
use std::{path::Path, sync::Mutex};

static ACCESS: Mutex<()> = Mutex::new(());

fn entry(root: &Path) -> Result<keyring::Entry> {
    if !cfg!(any(windows, target_os = "macos")) {
        return Err(failure("此平台尚不支持安全保存 Notion 令牌", "ECREDENTIAL"));
    }
    let profile = root.canonicalize().map_err(crate::io_error)?;
    keyring::Entry::new("com.larkanything.desktop.notion", &profile.to_string_lossy())
        .map_err(|_| failure("无法打开系统凭据存储", "ECREDENTIAL"))
}

pub fn read(root: &Path) -> Result<Option<String>> {
    let _guard = ACCESS.lock().unwrap();
    match entry(root)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(failure("无法读取已保存的 Notion 令牌，请解锁系统凭据存储后重试", "ECREDENTIAL")),
    }
}

pub fn save(root: &Path, token: &str) -> Result<()> {
    let _guard = ACCESS.lock().unwrap();
    entry(root)?.set_password(token).map_err(|_| failure("Notion 验证通过，但令牌未能保存到系统凭据存储，请重试", "ECREDENTIAL"))
}

pub fn delete(root: &Path) -> Result<()> {
    let _guard = ACCESS.lock().unwrap();
    match entry(root)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(failure("无法删除已保存的 Notion 令牌，请重试", "ECREDENTIAL")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Explicit opt-in, unique test profile. Separate invocations prove process restart.
    #[test]
    #[ignore]
    fn os_store_restart() {
        let root = std::path::PathBuf::from(std::env::var_os("LA_CREDENTIAL_TEST_ROOT").expect("isolated test root"));
        assert!(root.file_name().unwrap().to_string_lossy().starts_with("la-credential-test-"));
        match std::env::var("LA_CREDENTIAL_TEST_PHASE").unwrap().as_str() {
            "save" => { assert!(read(&root).unwrap().is_none()); save(&root, "synthetic-notion-restart-fixture").unwrap(); },
            "read" => { assert_eq!(read(&root).unwrap().as_deref(), Some("synthetic-notion-restart-fixture")); },
            "delete" => { delete(&root).unwrap(); assert!(read(&root).unwrap().is_none()); delete(&root).unwrap(); },
            _ => panic!("Unknown phase"),
        }
    }
}
