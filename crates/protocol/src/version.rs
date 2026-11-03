use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// The protocol version this crate speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// The `v` field of every message. It serializes as `1`, and deserializing any other value fails,
/// so a message from an incompatible peer cannot be mistaken for a valid one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, TS)]
#[ts(export, export_to = "protocol.ts", type = "1")]
pub struct ProtocolVersion;

impl Serialize for ProtocolVersion {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(PROTOCOL_VERSION)
    }
}

impl<'de> Deserialize<'de> for ProtocolVersion {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct VersionVisitor;

        impl Visitor<'_> for VersionVisitor {
            type Value = ProtocolVersion;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                write!(f, "protocol version {PROTOCOL_VERSION}")
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
                if v == PROTOCOL_VERSION {
                    Ok(ProtocolVersion)
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(v), &self))
                }
            }

            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
                match u64::try_from(v) {
                    Ok(v) => self.visit_u64(v),
                    Err(_) => Err(E::invalid_value(de::Unexpected::Signed(v), &self)),
                }
            }
        }

        deserializer.deserialize_u64(VersionVisitor)
    }
}

#[cfg(test)]
mod tests {
    use ts_rs::{Config, TS};

    use super::*;

    #[test]
    fn typescript_sees_a_literal_one() {
        let cfg = Config::default();
        assert_eq!(ProtocolVersion::inline(&cfg), "1");
        assert!(crate::ExtensionEnvelope::decl(&cfg).contains("v: ProtocolVersion"));
    }
}
