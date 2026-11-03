//! Where the island goes, from the screen's geometry. Pure arithmetic, tested on every platform;
//! the platform modules only read the numbers.

/// A rectangle in Cocoa's global coordinates: origin at the bottom left of the primary screen,
/// y growing upwards, in points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn max_x(&self) -> f64 {
        self.x + self.width
    }

    pub fn max_y(&self) -> f64 {
        self.y + self.height
    }
}

/// What the platform reports about the screen the island uses.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenInfo {
    pub frame: Rect,
    pub visible_frame: Rect,
    /// `safeAreaInsets.top`: positive only on a screen with a notch.
    pub safe_top: f64,
    /// `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`: the menu bar on each side of the notch.
    pub left_area: Rect,
    pub right_area: Rect,
    /// The primary screen's height, to convert to top-left coordinates.
    pub primary_height: f64,
}

/// The island's anchor, in the windowing system's top-left logical coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Anchor {
    pub has_notch: bool,
    /// Horizontal center of the notch, or of the screen without one.
    pub center_x: f64,
    /// Top of the island: the screen's top edge with a notch, just below the menu bar without.
    pub top_y: f64,
    pub notch_width: f64,
    /// The notch's height, or the menu bar's height without a notch.
    pub top_inset: f64,
}

/// Gap between the menu bar and the floating pill on screens without a notch.
pub const PILL_GAP: f64 = 6.0;

pub fn anchor(screen: &ScreenInfo) -> Anchor {
    let frame = screen.frame;
    let to_top_left_y = |cocoa_y: f64| screen.primary_height - cocoa_y;
    let menu_bar = (frame.max_y() - screen.visible_frame.max_y()).max(0.0);

    if screen.safe_top > 0.0 && screen.left_area.width > 0.0 && screen.right_area.width > 0.0 {
        // The auxiliary areas may come relative to the screen or in global coordinates.
        let offset = if screen.left_area.x < frame.x - 0.5 {
            frame.x
        } else {
            0.0
        };
        let notch_left = screen.left_area.max_x() + offset;
        let notch_right = screen.right_area.x + offset;
        if notch_right > notch_left {
            return Anchor {
                has_notch: true,
                center_x: (notch_left + notch_right) / 2.0,
                top_y: to_top_left_y(frame.max_y()),
                notch_width: notch_right - notch_left,
                top_inset: screen.safe_top,
            };
        }
    }
    Anchor {
        has_notch: false,
        center_x: frame.x + frame.width / 2.0,
        top_y: to_top_left_y(frame.max_y()) + menu_bar + PILL_GAP,
        notch_width: 0.0,
        top_inset: menu_bar,
    }
}

/// The island window's top-left corner for a contour of `width`.
pub fn origin(anchor: &Anchor, width: f64) -> (f64, f64) {
    (anchor.center_x - width / 2.0, anchor.top_y)
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

    #[test]
    fn finds_the_notch_on_a_built_in_screen() {
        let a = anchor(&built_in());
        assert!(a.has_notch);
        assert_eq!(a.notch_width, 185.0);
        assert_eq!(a.center_x, 755.5);
        assert_eq!(a.top_y, 0.0);
        assert_eq!(a.top_inset, 32.0);
        assert_eq!(origin(&a, 390.0), (560.5, 0.0));
    }

    #[test]
    fn handles_a_built_in_screen_that_is_not_the_primary_one() {
        // An external primary display above-left; the MacBook below it, offset to the right.
        let mut screen = built_in();
        screen.frame = rect(1920.0, -982.0, 1512.0, 982.0);
        screen.visible_frame = rect(1920.0, -982.0, 1512.0, 950.0);
        screen.primary_height = 1080.0;
        // Relative areas, as some systems report them.
        let a = anchor(&screen);
        assert!(a.has_notch);
        assert_eq!(a.center_x, 1920.0 + 755.5);
        assert_eq!(a.top_y, 1080.0);

        // The same areas in global coordinates give the same anchor.
        screen.left_area = rect(1920.0, -32.0, 663.0, 32.0);
        screen.right_area = rect(1920.0 + 848.0, -32.0, 664.0, 32.0);
        assert_eq!(anchor(&screen).center_x, 1920.0 + 755.5);
    }

    #[test]
    fn falls_back_to_a_pill_below_the_menu_bar() {
        let screen = ScreenInfo {
            frame: rect(0.0, 0.0, 1920.0, 1080.0),
            visible_frame: rect(0.0, 0.0, 1920.0, 1055.0),
            safe_top: 0.0,
            left_area: rect(0.0, 0.0, 0.0, 0.0),
            right_area: rect(0.0, 0.0, 0.0, 0.0),
            primary_height: 1080.0,
        };
        let a = anchor(&screen);
        assert!(!a.has_notch);
        assert_eq!(a.center_x, 960.0);
        assert_eq!(a.top_inset, 25.0);
        assert_eq!(a.top_y, 25.0 + PILL_GAP);
        assert_eq!(origin(&a, 340.0), (790.0, 31.0));
    }
}
