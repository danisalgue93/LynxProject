#[test]
fn protocol_id_is_configured() {
    assert_eq!(
        lynx_protocol::id().to_string(),
        "7hPfrAwhNPJ6Xt7Y3ximBog1EdzfJV31VBTnYQxLRYCy"
    );
}
