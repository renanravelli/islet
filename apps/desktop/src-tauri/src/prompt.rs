//! The update balloon under the menu bar icon (ADR 0006, docs/design/ui-spec.md section 4).
//!
//! When an automatic check finds a version, the balloon offers it with "Atualizar" and
//! "Depois". It waits while a call is on, so it never shows up in a shared screen; it closes only
//! through its buttons; after "Depois" it comes back with the next automatic check. Installing
//! from the menu also opens it, to show the progress. The rules and the placement are pure
//! functions; the rest only moves the panel.

use tauri::{AppHandle, Emitter, Manager};

use crate::geometry::{self, Rect, ScreenInfo};
use crate::model::{PromptMode, PromptView, UpdateState};
use crate::platform;
use crate::state::{AppState, lock};

pub const LABEL: &str = "update";

/// The balloon's width, which the page uses as given.
pub const WIDTH: f64 = 300.0;
/// Kept from the screen's edges.
const MARGIN: f64 = 8.0;
/// The arrow stays clear of the rounded corners.
const ARROW_INSET: f64 = 22.0;
/// Between the menu bar icon and the arrow's tip.
const GAP: f64 = 2.0;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Prompt {
    /// Offered by an automatic check, or opened by an install from the menu, and not answered
    /// with "Depois" since.
    pub pending: bool,
    /// What the page was last told, `None` while hidden.
    shown: Option<PromptView>,
    /// Where the shown balloon goes, its top-left corner in top-left logical coordinates.
    origin: Option<(f64, f64)>,
    /// The page's height for `shown`, once it has said it.
    height: Option<f64>,
}

/// What the balloon shows, if anything: only while it is pending, outside a call, and for an
/// update state it has something to say about.
pub fn mode(
    pending: bool,
    update: &UpdateState,
    in_call: bool,
) -> Option<(PromptMode, Option<String>)> {
    if !pending || in_call {
        return None;
    }
    match update {
        UpdateState::Available { version } => Some((PromptMode::Offer, Some(version.clone()))),
        UpdateState::Installing => Some((PromptMode::Installing, None)),
        UpdateState::InstallFailed => Some((PromptMode::Failed, None)),
        _ => None,
    }
}

/// The menu bar icon, as the platform reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrayItem {
    /// The icon's frame, in Cocoa's global coordinates.
    pub frame: Rect,
    /// The screen whose menu bar holds it.
    pub screen: ScreenInfo,
    /// Whether the status item and its window are shown. An icon the menu bar has no room for, or
    /// that a menu bar manager hides, is told from its frame: behind the notch or off screen.
    pub visible: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    /// The top-left corner, in top-left logical coordinates.
    pub origin: (f64, f64),
    pub arrow: Option<f64>,
}

/// Below the menu bar icon, pointing at it, inside its screen. When the icon is hidden or not
/// in a menu bar (a full-screen app hides it), at the top right of `fallback`, the island's
/// screen, without the arrow.
pub fn placement(
    item: Option<&TrayItem>,
    fallback: Option<&ScreenInfo>,
    width: f64,
) -> Option<Placement> {
    if let Some(item) = item.filter(|item| usable(item)) {
        let screen = &item.screen;
        let visible = screen.visible_frame;
        let center = item.frame.x + item.frame.width / 2.0;
        let left = (center - width / 2.0)
            .min(visible.max_x() - MARGIN - width)
            .max(visible.x + MARGIN);
        let arrow = (center - left).clamp(ARROW_INSET, width - ARROW_INSET);
        return Some(Placement {
            origin: (left, screen.primary_height - item.frame.y + GAP),
            arrow: Some(arrow),
        });
    }
    let screen = fallback?;
    let visible = screen.visible_frame;
    Some(Placement {
        origin: (
            visible.max_x() - MARGIN - width,
            screen.primary_height - visible.max_y() + MARGIN,
        ),
        arrow: None,
    })
}

fn usable(item: &TrayItem) -> bool {
    let (frame, screen) = (item.frame, &item.screen);
    let center = frame.x + frame.width / 2.0;
    let on_screen = center > screen.frame.x && center < screen.frame.max_x();
    // In the menu bar: at or above the bottom of the area apps may use.
    let in_menu_bar = frame.max_y() > screen.visible_frame.max_y() + 0.5;
    let anchor = geometry::anchor(screen);
    let under_notch =
        anchor.has_notch && (center - anchor.center_x).abs() < anchor.notch_width / 2.0;
    item.visible && frame.width > 0.0 && on_screen && in_menu_bar && !under_notch
}

/// Whether a call is on: the balloon waits for it to end.
fn in_call(state: &AppState) -> bool {
    state
        .sessions
        .snapshot()
        .borrow()
        .primary
        .as_ref()
        .is_some_and(|session| session.status == islet_core::SessionStatus::Active)
}

/// Shows, updates, moves or hides the balloon after the update state, a call, an answer or the
/// screens changed.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply(&handle));
}

/// Main thread only.
fn apply(app: &AppHandle) {
    let state = app.state::<AppState>();
    let pending = lock(&state.prompt).pending;
    let update = lock(&state.update).clone();
    let view = mode(pending, &update, in_call(&state)).and_then(|(mode, version)| {
        let item = platform::tray_item(app);
        let place = placement(item.as_ref(), platform::screen_info().as_ref(), WIDTH)?;
        Some((
            PromptView {
                mode,
                version,
                width: WIDTH,
                arrow: place.arrow,
            },
            place.origin,
            item,
        ))
    });

    let mut prompt = lock(&state.prompt);
    match view {
        None => {
            if prompt.shown.take().is_some() {
                prompt.origin = None;
                prompt.height = None;
                drop(prompt);
                tracing::debug!("update balloon hidden");
                platform::place_prompt(app, LABEL, None);
                let _ = app.emit_to(LABEL, "update-prompt", None::<PromptView>);
            }
        }
        Some((view, origin, item)) => {
            let moved = prompt.origin != Some(origin);
            prompt.origin = Some(origin);
            if prompt.shown.as_ref() == Some(&view) {
                // Same content: the page will not measure again, so move it here.
                let height = prompt.height;
                drop(prompt);
                if let (true, Some(height)) = (moved, height) {
                    platform::place_prompt(app, LABEL, Some((origin, (WIDTH, height))));
                }
                return;
            }
            prompt.shown = Some(view.clone());
            drop(prompt);
            if let Err(error) = platform::create_prompt(app, LABEL, "update.html") {
                tracing::warn!(%error, "cannot create the update balloon");
                return;
            }
            // The page draws it and then reports its height (`laid_out`), which shows it.
            // Positions only, for checking the placement (a hidden icon's frame, for example).
            tracing::debug!(mode = ?view.mode, arrow = ?view.arrow, ?origin, ?item, "update balloon");
            let _ = app.emit_to(LABEL, "update-prompt", Some(&view));
        }
    }
}

/// What the page should draw now (it asks once it has loaded).
pub fn current(app: &AppHandle) -> Option<PromptView> {
    lock(&app.state::<AppState>().prompt).shown.clone()
}

/// The page drew the balloon at `height`: show it there.
pub fn laid_out(app: &AppHandle, height: f64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = handle.state::<AppState>();
        let mut prompt = lock(&state.prompt);
        let Some(origin) = prompt.origin.filter(|_| prompt.shown.is_some()) else {
            return;
        };
        prompt.height = Some(height);
        drop(prompt);
        tracing::debug!(height, "update balloon shown");
        platform::place_prompt(&handle, LABEL, Some((origin, (WIDTH, height))));
    });
}

/// "Depois": closes the balloon until the next automatic check.
pub fn later(app: &AppHandle) {
    lock(&app.state::<AppState>().prompt).pending = false;
    refresh(app);
}

/// An install from the menu: the balloon opens with the progress once the install starts.
pub fn follow_install(app: &AppHandle) {
    lock(&app.state::<AppState>().prompt).pending = true;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    /// The owner's MacBook (Mac15,6): 1512×982 pt, notch 185 pt wide, 32 pt tall.
    fn built_in() -> ScreenInfo {
        ScreenInfo {
            frame: rect(0.0, 0.0, 1512.0, 982.0),
            visible_frame: rect(0.0, 0.0, 1512.0, 950.0),
            safe_top: 32.0,
            left_area: rect(0.0, 950.0, 663.0, 32.0),
            right_area: rect(848.0, 950.0, 664.0, 32.0),
            primary_height: 982.0,
        }
    }

    fn icon(x: f64) -> TrayItem {
        TrayItem {
            frame: rect(x, 950.0, 36.0, 32.0),
            screen: built_in(),
            visible: true,
        }
    }

    #[allow(non_snake_case)]
    fn AVAILABLE() -> UpdateState {
        UpdateState::Available {
            version: "0.1.5".to_owned(),
        }
    }

    #[test]
    fn offers_a_pending_version_outside_a_call() {
        assert_eq!(
            mode(true, &AVAILABLE(), false),
            Some((PromptMode::Offer, Some("0.1.5".to_owned())))
        );
        assert_eq!(
            mode(true, &UpdateState::Installing, false),
            Some((PromptMode::Installing, None))
        );
        assert_eq!(
            mode(true, &UpdateState::InstallFailed, false),
            Some((PromptMode::Failed, None))
        );
    }

    #[test]
    fn waits_for_the_call_to_end_and_stays_closed_after_later() {
        assert_eq!(mode(true, &AVAILABLE(), true), None);
        assert_eq!(mode(true, &UpdateState::Installing, true), None);
        assert_eq!(mode(false, &AVAILABLE(), false), None);
    }

    #[test]
    fn says_nothing_about_other_update_states() {
        for state in [
            UpdateState::Idle,
            UpdateState::Checking,
            UpdateState::UpToDate,
            UpdateState::CheckFailed,
        ] {
            assert_eq!(mode(true, &state, false), None, "{state:?}");
        }
    }

    #[test]
    fn points_at_the_icon_from_below() {
        let place = placement(Some(&icon(1200.0)), None, WIDTH).unwrap();
        // Centered on the icon (1218), just below the menu bar (32 pt from the top).
        assert_eq!(place.origin, (1068.0, 34.0));
        assert_eq!(place.arrow, Some(150.0));
    }

    #[test]
    fn stays_on_screen_and_moves_the_arrow_instead() {
        let place = placement(Some(&icon(1460.0)), None, WIDTH).unwrap();
        assert_eq!(place.origin.0, 1512.0 - MARGIN - WIDTH);
        assert_eq!(place.arrow, Some(1478.0 - (1512.0 - MARGIN - WIDTH)));

        let place = placement(Some(&icon(1490.0)), None, WIDTH).unwrap();
        assert_eq!(place.arrow, Some(WIDTH - ARROW_INSET));
    }

    #[test]
    fn falls_back_to_the_top_right_without_the_arrow() {
        let fallback = built_in();
        let expected = Placement {
            origin: (1512.0 - MARGIN - WIDTH, 32.0 + MARGIN),
            arrow: None,
        };
        // Hidden by macOS or a menu bar manager.
        let mut hidden = icon(1200.0);
        hidden.visible = false;
        // Behind the notch, where macOS puts icons it has no room for.
        let behind_notch = icon(740.0);
        // Not in a menu bar: a full-screen app hides it.
        let mut no_menu_bar = icon(1200.0);
        no_menu_bar.screen.visible_frame = rect(0.0, 0.0, 1512.0, 982.0);
        // Off every screen.
        let off_screen = icon(-200.0);
        for item in [hidden, behind_notch, no_menu_bar, off_screen] {
            assert_eq!(
                placement(Some(&item), Some(&fallback), WIDTH),
                Some(expected),
                "{item:?}"
            );
        }
        assert_eq!(placement(None, Some(&fallback), WIDTH), Some(expected));
        assert_eq!(placement(None, None, WIDTH), None);
    }

    #[test]
    fn places_on_a_second_screen_in_global_coordinates() {
        // An external display to the right of the MacBook, without a notch, 25 pt menu bar.
        let screen = ScreenInfo {
            frame: rect(1512.0, 0.0, 1920.0, 1080.0),
            visible_frame: rect(1512.0, 0.0, 1920.0, 1055.0),
            safe_top: 0.0,
            left_area: rect(0.0, 0.0, 0.0, 0.0),
            right_area: rect(0.0, 0.0, 0.0, 0.0),
            primary_height: 982.0,
        };
        let item = TrayItem {
            frame: rect(3000.0, 1055.0, 36.0, 25.0),
            screen,
            visible: true,
        };
        let place = placement(Some(&item), None, WIDTH).unwrap();
        assert_eq!(place.origin, (3018.0 - WIDTH / 2.0, 982.0 - 1055.0 + GAP));
    }
}
