use std::fmt;

use serde::ser::SerializeSeq;
use serde::{Deserialize, Serialize, Serializer};

/// A meeting control the UI can trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Command {
    ToggleMic,
    ToggleCam,
    ToggleHand,
    Leave,
    /// Bring the meeting's window or tab to the front.
    FocusTab,
}

impl Command {
    pub const ALL: [Self; 5] = [
        Self::ToggleMic,
        Self::ToggleCam,
        Self::ToggleHand,
        Self::Leave,
        Self::FocusTab,
    ];

    const fn bit(self) -> u8 {
        1 << self as u8
    }
}

/// A set of [`Command`]s: what a provider or a session supports.
#[derive(Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct CapabilitySet(u8);

impl CapabilitySet {
    pub const EMPTY: Self = Self(0);

    pub const fn all() -> Self {
        let mut bits = 0;
        let mut i = 0;
        while i < Command::ALL.len() {
            bits |= Command::ALL[i].bit();
            i += 1;
        }
        Self(bits)
    }

    pub const fn contains(self, command: Command) -> bool {
        self.0 & command.bit() != 0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub fn insert(&mut self, command: Command) {
        self.0 |= command.bit();
    }

    pub fn remove(&mut self, command: Command) {
        self.0 &= !command.bit();
    }

    #[must_use]
    pub const fn intersection(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    pub fn iter(self) -> impl Iterator<Item = Command> {
        Command::ALL.into_iter().filter(move |c| self.contains(*c))
    }
}

impl FromIterator<Command> for CapabilitySet {
    fn from_iter<I: IntoIterator<Item = Command>>(iter: I) -> Self {
        let mut set = Self::EMPTY;
        for command in iter {
            set.insert(command);
        }
        set
    }
}

impl fmt::Debug for CapabilitySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(self.iter()).finish()
    }
}

impl Serialize for CapabilitySet {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(None)?;
        for command in self.iter() {
            seq.serialize_element(&command)?;
        }
        seq.end()
    }
}

/// Why a command failed. Commands never change the displayed state; only a confirmed update
/// from the provider does (`docs/adr/0003`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum CommandError {
    #[error("no such session")]
    NoSession,
    #[error("the session has ended")]
    SessionEnded,
    #[error("the session does not support this command")]
    Unsupported,
    #[error("the provider is not connected")]
    Disconnected,
    #[error("the control for this command could not be found")]
    ControlNotFound,
    #[error("the provider did not observe the change")]
    NotConfirmed,
    #[error("the provider did not answer in time")]
    Timeout,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_set_operations() {
        let mut set: CapabilitySet = [Command::ToggleMic, Command::Leave].into_iter().collect();
        assert!(set.contains(Command::ToggleMic));
        assert!(!set.contains(Command::ToggleCam));
        set.insert(Command::ToggleCam);
        set.remove(Command::Leave);
        assert_eq!(
            set.iter().collect::<Vec<_>>(),
            [Command::ToggleMic, Command::ToggleCam]
        );
        assert_eq!(
            set.intersection([Command::ToggleCam].into_iter().collect()),
            [Command::ToggleCam].into_iter().collect()
        );
        assert!(CapabilitySet::EMPTY.is_empty());
        assert_eq!(CapabilitySet::all().iter().count(), Command::ALL.len());
    }

    #[test]
    fn capability_set_serializes_as_a_list() {
        let set: CapabilitySet = [Command::FocusTab, Command::ToggleHand]
            .into_iter()
            .collect();
        assert_eq!(
            serde_json::to_string(&set).unwrap(),
            r#"["toggle_hand","focus_tab"]"#
        );
    }
}
