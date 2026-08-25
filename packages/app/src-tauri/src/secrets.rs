const SERVICE: &str = "ReadAny";
const ACCOUNT_PREFIX: &str = "opds.catalog.";
const ACCOUNT_SUFFIX: &str = ".password";

#[derive(Clone, Copy)]
enum SecretOperation {
    Get,
    Set,
    Remove,
}

fn redacted_error(operation: SecretOperation) -> String {
    match operation {
        SecretOperation::Get => "Failed to read secret",
        SecretOperation::Set => "Failed to store secret",
        SecretOperation::Remove => "Failed to remove secret",
    }
    .to_string()
}

fn credential_account(key: &str) -> Result<String, String> {
    let catalog_id = key
        .strip_prefix(ACCOUNT_PREFIX)
        .and_then(|value| value.strip_suffix(ACCOUNT_SUFFIX))
        .ok_or_else(|| "Invalid secret key".to_string())?;
    let id = uuid::Uuid::parse_str(catalog_id).map_err(|_| "Invalid secret key".to_string())?;
    if id.get_version_num() != 4 || id.to_string() != catalog_id {
        return Err("Invalid secret key".to_string());
    }
    Ok(format!("{ACCOUNT_PREFIX}{catalog_id}{ACCOUNT_SUFFIX}"))
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    let account = credential_account(&key)?;
    let entry =
        keyring::Entry::new(SERVICE, &account).map_err(|_| redacted_error(SecretOperation::Set))?;
    entry
        .set_password(&value)
        .map_err(|_| redacted_error(SecretOperation::Set))
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    let account = credential_account(&key)?;
    let entry =
        keyring::Entry::new(SERVICE, &account).map_err(|_| redacted_error(SecretOperation::Get))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(redacted_error(SecretOperation::Get)),
    }
}

fn map_remove_result(result: Result<(), keyring::Error>) -> Result<(), String> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(redacted_error(SecretOperation::Remove)),
    }
}

#[tauri::command]
pub fn secret_remove(key: String) -> Result<(), String> {
    let account = credential_account(&key)?;
    let entry = keyring::Entry::new(SERVICE, &account)
        .map_err(|_| redacted_error(SecretOperation::Remove))?;
    map_remove_result(entry.delete_credential())
}

#[cfg(test)]
mod tests {
    use super::{credential_account, map_remove_result, redacted_error, SecretOperation, SERVICE};

    const FIRST_ID: &str = "11111111-1111-4111-8111-111111111111";
    const SECOND_ID: &str = "22222222-2222-4222-8222-222222222222";

    #[test]
    fn uses_fixed_service_and_collision_free_catalog_accounts() {
        assert_eq!(SERVICE, "ReadAny");
        let first = format!("opds.catalog.{FIRST_ID}.password");
        let second = format!("opds.catalog.{SECOND_ID}.password");
        assert_eq!(credential_account(&first).unwrap(), first);
        assert_eq!(credential_account(&second).unwrap(), second);
        assert_ne!(credential_account(&first), credential_account(&second));
    }

    #[test]
    fn rejects_accounts_not_derived_from_a_custom_catalog_id() {
        for key in [
            "opds.catalog.__proto__.password",
            "opds.catalog.gutenberg.password",
            "opds.catalog.11111111-1111-4111-8111-111111111111.password.extra",
            "sync_webdav_password",
        ] {
            assert_eq!(
                credential_account(key),
                Err("Invalid secret key".to_string())
            );
        }
    }

    #[test]
    fn redacts_backend_details_with_fixed_operation_errors() {
        assert_eq!(
            redacted_error(SecretOperation::Get),
            "Failed to read secret"
        );
        assert_eq!(
            redacted_error(SecretOperation::Set),
            "Failed to store secret"
        );
        assert_eq!(
            redacted_error(SecretOperation::Remove),
            "Failed to remove secret"
        );
        for operation in [
            SecretOperation::Get,
            SecretOperation::Set,
            SecretOperation::Remove,
        ] {
            let error = redacted_error(operation);
            assert!(!error.contains("secret-password"));
            assert!(!error.contains("backend"));
        }
    }

    #[test]
    fn removing_a_missing_entry_is_idempotent() {
        assert_eq!(map_remove_result(Err(keyring::Error::NoEntry)), Ok(()));
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn selected_desktop_backend_persists_until_delete() {
        assert!(matches!(
            keyring::default::default_credential_builder().persistence(),
            keyring::credential::CredentialPersistence::UntilDelete
        ));
    }
}
