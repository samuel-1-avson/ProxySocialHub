use super::cleanup_db_refusal;

#[test]
fn refuses_without_allow_flag() {
    assert!(cleanup_db_refusal(None, Some("DROP_TABLES"), Some("development")).is_some());
    assert!(cleanup_db_refusal(Some("false"), Some("DROP_TABLES"), Some("development")).is_some());
}

#[test]
fn refuses_without_typed_confirmation() {
    assert!(cleanup_db_refusal(Some("true"), None, Some("development")).is_some());
    assert!(cleanup_db_refusal(Some("true"), Some("yes"), Some("development")).is_some());
}

#[test]
fn refuses_in_production() {
    assert!(cleanup_db_refusal(Some("true"), Some("DROP_TABLES"), Some("production")).is_some());
    assert!(cleanup_db_refusal(Some("1"), Some("DROP_TABLES"), Some("PROD")).is_some());
}

#[test]
fn allows_when_all_guards_pass() {
    assert!(cleanup_db_refusal(Some("true"), Some("DROP_TABLES"), Some("testnet")).is_none());
    assert!(cleanup_db_refusal(Some("yes"), Some("DROP_TABLES"), None).is_none());
}
