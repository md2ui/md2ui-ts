# Home dashboard

<!-- Reproduction target: reference-wide.png / reference-narrow.png and the
     Screenshot*.png frames from the same Whipsaw phone-OS exploration — a mosaic
     of OS-style home-screen widgets on a light grey field: mostly white cards,
     a handful of dark ones (rain, next-bus green and blue, yellow-line, boarding
     pass, unread mail), two music cards over a photo or gradient, and three
     bare vertical slider tiles. Written from scratch; the widget look shares
     nothing with the repo THEME.md. -->

## Styling & Spacing

### Root
Background color: #F4F4F5
Padding: 40
Spacing: 32
Layout: Auto
Vertical align: Center
<!-- The reference is a five-column board; Bento aims at ~260px per column, so the
     column count follows the width. 1600 gives five. -->
Max width: 1600

### Elements
Row spacing: 8
Col spacing: 6
Group spacing: 14
Image distance: 14
Padding: 0

### Heading 2
Background color: #FFFFFF
Corner radius: 30
Padding: 22
Spacing: 14
Image corner radius: 18
<!-- The maps in the transit, walk and yellow-line cards run to the card edge in
     the reference: a full-width map bleeds left/right/bottom, a map beside the
     text bleeds top/right/bottom. Capped pictures (logos, the Clipper card)
     opt themselves out. -->
Image bleed: yes
<!-- The cards ARE the sections, so the glued groups inside them must not paint a
     second card on top. -->
<!-- A soft lift rather than a hard edge: a tight contact layer to seat the card,
     then a wide low-alpha one for the shadow itself. Declared order is paint
     order. -->
Outer shadow:
- Offset y: 1
- Color: #1C1C1E0A
- Radius: 2
Outer shadow:
- Offset y: 12
- Color: #1C1C1E12
- Radius: 36

<!-- Every card that is not white is named in content.md (`## {#rain-1}`) and
     takes one of these. `Mode: override` keeps Heading 2's radius, padding and
     shadow, so each block states only its paint — and a new card never shifts
     the colour of the cards after it, as a positional colour list would. -->

### Fixed styles

<!-- The dark and coloured cards repeat Heading 2's two shadows deeper: at the
     white cards' 7% the drop disappears against a dark edge. A shadow stated in
     an override block replaces the level's, so each states both layers. -->

<!-- The weather cards' temperature is the largest figure on the board. -->
#### Weather
Mode: override
##### Display
- Font size: 56
- Font weight: 500

#### Rain
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #3B4059
##### Display
- Font size: 56
- Font weight: 500

#### Next bus
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #16311F
##### Display
- Marker text color: #A6E59B

#### Next bus blue
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #283A8E

#### Transit dark
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #121212

#### Boarding pass
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #000000

#### Mail
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #2A2A2E

<!-- The first player (Loretta, Ginger Root) sits on a cool blue-to-blush wash. -->
#### Music player
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #8FA6D6
Background gradient:
- Type: Linear
- Ratios:
  - 0.0
  - 0.55
  - 1.0
- Colors:
  - #5C8FD0
  - #B9A9D8
  - #F2A9A0
- Parameters:
  - Start: 0.0, 0.0
  - End: 1.0, 1.0

<!-- The second player (Juna, Clairo) sits on a warm copper-to-plum wash. -->
#### Music player warm
Mode: override
Outer shadow:
- Offset y: 2
- Color: #1C1C1E1A
- Radius: 4
Outer shadow:
- Offset y: 14
- Color: #1C1C1E33
- Radius: 36
Background color: #8A4A35
Background gradient:
- Type: Linear
- Ratios:
  - 0.0
  - 0.55
  - 1.0
- Colors:
  - #C9773E
  - #9A4A33
  - #4A1E2E
- Parameters:
  - Start: 0.8, 0.0
  - End: 0.2, 1.0

<!-- The home-control tiles: the slider IS the tile, so the card around it
     paints nothing and keeps no padding. -->
#### Slider tile
Mode: override
Background color: #00000000
Padding: 0
Outer shadow:
- Color: #00000000

<!-- The booking card's map: the arrival tag and the back button sit inset
     from the picture's edge, and the picture rounds like the reference's. -->
### Image Cards
Corner radius: 18
Padding: 14

<!-- The calendar card's tinted event rows. `### Unordered Lists` paints each
     `- ` item and the colour list is dealt per item, restarting inside each
     section — so the rows are an ordinary list and a second calendar card
     would tint identically with no extra key. -->

### Unordered Lists
Corner radius: 16
Padding: 14
Background color:
- #F2F2F4
- #F7EAE7
- #DDE1F3

<!-- The to-do card's rows are `- [ ]` items, which inherit the whole
     `### Unordered Lists` style unless this block declares its own. The
     reference has them plain on the card. -->

### Task Lists
Background color: #00000000
Corner radius: 0
Padding: 0

### Quotes
#### Marker
Bar width: 3
Bar length: 50
Bar color:
- #34C759
- #34C759
- #0A84FF
Space: 12

## Text Styles

Text
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 500
- Font color: #1C1C1E

Heading2
<!-- The board's cards are untitled `## ` markers, so this only shows in content
     that titles its sections. -->
- Font Name: Inter 18pt
- Font size: 24
- Font weight: 600
- Font color: #1C1C1E

Text Overline
- Font Name: Inter 18pt
- Font size: 13
- Font weight: 400
- Font color: #8A8A8E

Muted
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 400
- Font color: #8A8A8E

Lead
- Font Name: Inter 18pt
- Font size: 24
- Font weight: 500
- Font color: #1C1C1E

Display
- Font Name: Inter 18pt
- Font size: 34
- Font weight: 700
- Font color: #1C1C1E

Key
- Font Name: Inter 18pt
- Font size: 13
- Font weight: 400
- Font color: #8A8A8E

Value
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 500
- Font color: #1C1C1E

Labels
- Font Name: Inter 18pt
- Font size: 12
- Font weight: 400
- Font color: #8A8A8E

Links
- Font Name: Inter 18pt
- Font size: 18
- Font weight: 500
- Font color: #FFFFFF

Links Tertiary
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 500
- Font color: #1C1C1E

Links Secondary
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 500
- Font color: #8A8A8E

Inline Code
- Font Name: Inter 18pt
- Font size: 17
- Font weight: 600
- Font color: #FFFFFF

## Links

### Primary
<!-- The one action a card is for: "Search", "Finalize booking" — a black
     capsule. -->
Corner radius: 28
Fill color: #111111
Padding top: 16
Padding bottom: 16
Padding left: 64
Padding right: 64
Stroke width: 0

### Secondary
<!-- The quiet corner icons (refresh, +, close, back) and the player controls:
     a bare glyph, no fill. -->
Corner radius: 20
Fill color: #00000000
Padding: 4
Stroke width: 0
Emoji shape: circle

### Tertiary
<!-- The map's back button: a white rounded square over the picture. -->
Corner radius: 12
Fill color: #FFFFFF
Padding: 10
Stroke width: 0
Emoji shape: square

## Inline Code
<!-- The "To do" / "Reminders" / "Auto Search" header pills, the 🚌30 route
     badge and the map's arrival tag. -->
Corner radius: 20
Padding top: 7
Padding bottom: 7
Padding left: 16
Padding right: 16
Fill color: #6E85DE
Stroke width: 0

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

### Primary
Shape: circle
Size: 28
Padding: 4
Background color: #00000000

### Text
Color: #1C1C1E

### Link
Color: #8A8A8E

## Fixed colors

### Emoji
<!-- The weather glyphs carry meaning, so they are pinned rather than left to the
     card's own ink. The font is monochrome, so a glyph takes ONE colour. -->
- ☀️ #F5B301
- 🌧️ #FFFFFF
- 📍 #FFFFFF
- ✓ #FFFFFF
- ✉️ #FFFFFF
- 🏷️ #B8B8BD
- 🔊 #3A3A3C
- 💡 #3A3A3C
- 🔆 #3A3A3C
- ⬅️ #1C1C1E

### Emoji background
- 📍 #00000000
- ✓ #8FD39A

### Badges
#### Exact
- To do: Text color: #FFFFFF, Fill color: #6E85DE
- Reminders: Text color: #FFFFFF, Fill color: #EE6E5E
- Auto Search: Text color: #FFFFFF, Fill color: #7B93E8
- Search Results: Text color: #FFFFFF, Fill color: #7B93E8
- Arrive 6:02–6:12 PM: Text color: #FFFFFF, Fill color: #D6249F
- 🚌30: Text color: #1C1C1E, Fill color: #FFFFFF

## Color Replacements

<!-- One rule per dark card background makes every glyph, rule and badge on it
     legible without touching a single text style. -->

On background color: #3B4059
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #A9AEC4
- Stroke color: #E5E5EA, Replacement: #FFFFFF33

On background color: #16311F
- Text color: #A6E59B, Replacement: #A6E59B
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #7F9A87
- Stroke color: #E5E5EA, Replacement: #FFFFFF33

On background color: #283A8E
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #9AA6D6
- Stroke color: #E5E5EA, Replacement: #FFFFFF33

On background color: #121212
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #9A9A9E
- Stroke color: #E5E5EA, Replacement: #FFFFFF33

On background color: #000000
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #8A8A8E
- Stroke color: #E5E5EA, Replacement: #FFFFFF33

On background color: #2A2A2E
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #9A9A9E

On background color: #8A4A35
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #F1DCD2

<!-- The first player's blue-to-blush wash (its base colour keys the rule). -->
On background color: #8FA6D6
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #F2EEFA

On background color: image
- Replacement: #FFFFFF
- Text color: #1C1C1E, Replacement: #FFFFFF
- Text color: #8A8A8E, Replacement: #E6E6EA

## Horizontal Rule
Stroke color: #E5E5EA
Stroke width: 1

## Separators
Dash: hide
Bullet: show
Bar: hide

## Content arrangement

### Bento
Heading level: 2

## Drawing elements

### Emphasis
Enabled: yes

<!-- `Mon-15` / `Fri-20` draw as a day chip — the weekday uppercased over the
     day number. That IS the calendar-widget header. The reference has no tile
     behind it, so the chip fill is transparent and only the two type styles
     do the work. -->

### Dates
Enabled: yes
Fill: single
Spacing: 0
Background color: #00000000
Padding: 0

### Date Key
- Font Name: Inter 18pt
- Font size: 20
- Font weight: 400
- Font color: #1C1C1E

### Date Day
- Font Name: Inter 18pt
- Font size: 40
- Font weight: 600
- Font color: #1C1C1E

<!-- The reference's to-do controls are thin pale rings, no fill, no depth. -->
### Task controls
Enabled: yes
Type: checkbox
Size: 32
Padding: 3
Space: 12

### Checked outer
Background color: #6E85DE
Corner radius: 16
### Checked inner
Background color: #FFFFFF
### Unchecked outer
Background color: #FFFFFF
Corner radius: 16
Stroke color: #D8D8DC
Stroke width: 1.5
### Unchecked inner
Background color: #00000000

<!-- The home-control tiles: a tall rounded slab, the filled part pale and
     rising from the bottom, the empty part a darker warm grey, no handle. -->
### Sliders
Enabled: yes
Style: thick
Axis: vertical
Length: 240
Thickness: 90
Corner radius: 40
Drag bar length: 0
Bar thickness: 0

### Slider Track
<!-- The slider IS the home-control tile (its card paints nothing), so it carries
     the cards' two shadows itself. -->
Background color: #AEA6A2
Outer shadow:
- Offset y: 1
- Color: #1C1C1E0A
- Radius: 2
Outer shadow:
- Offset y: 12
- Color: #1C1C1E12
- Radius: 36

### Slider Bar
Background color: #EEEBE7

### Slider Handle
Background color: #00000000

## Fonts
- assets/fonts/Inter_18pt-Regular.ttf
- assets/fonts/Inter_18pt-Medium.ttf
- assets/fonts/Inter_18pt-SemiBold.ttf
- assets/fonts/Inter_18pt-Bold.ttf
