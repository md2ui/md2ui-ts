# Mellowbox

<!-- A calm landing page for a made-up delivery service: a warm cream page,
     lavender and powder-blue accents, soft rounded pills, generous space and
     Google Sans throughout.

     Palette:
       #FBFAF7  page (warm cream)
       #F3EEFB  the lavender band
       #CDB8F3  lavender: the main pill, accents
       #B9C6EC  powder blue: the second stat
       #2A2725  headings and body
       #7B756F  muted copy;  #A9A39C  the headline's quieter half
       #EEE9F5  the footer band

     Each band names its own look with a heading id: `# {#split-lavender-1}` selects
     `#### Split lavender`, so no band depends on its place in a colour cycle. -->

## Styling & Spacing

### Root
Layout: Auto
Background color: #FBFAF7
Padding: 0
<!-- The bands run edge to edge. -->
Max width: 1920
Spacing: 0
Horizontal align: Left
Spacer small: 8
Spacer medium: 16
Spacer large: 56

### Elements
Row spacing: 12
Col spacing: 10
Group spacing: 22
Image distance: 28
Padding: 0

### Heading 1
<!-- A plain `# ` band (any content that names no band style): cream, inset. -->
Padding top: 56
Padding bottom: 56
Padding left: 64
Padding right: 64
Spacing: 28

### Heading 2
<!-- Any `## ` is the white card `### ` draws: a hairline edge and a soft lift. This
     page's own section titles keep their plain look with `{#section-title-n}`. -->
Background color: #FFFFFF
Corner radius: 28
Padding: 28
Spacing: 16
Stroke width: 1
Stroke color: #EFEBE6
Image corner radius: 20
Outer shadow:
- Offset y: 10
- Color: #6E5A9A14
- Radius: 30

### Heading 3
<!-- The card: white, a hairline edge and a soft lift (the gift cards, any `### `). -->
Background color: #FFFFFF
Corner radius: 28
Padding: 28
Spacing: 16
Stroke width: 1
Stroke color: #EFEBE6
Image corner radius: 20
Outer shadow:
- Offset y: 10
- Color: #6E5A9A14
- Radius: 30

### Heading 4
Padding: 12
Spacing: 16

### Heading 5
Padding: 0
Spacing: 12

### Heading 6
Padding: 0
Spacing: 14

### Unordered Lists
#### Marker
Shape: circle
Size: 7
Color: #B79CEB
Space: 12
Alignment: center

### Task Lists
<!-- The checkbox is the marker: no bullet beside it. -->
#### Marker
Shape: circle
Size: 0
Space: 0
Color: #00000000

### Numbered Lists
#### Marker
Number format: 1.
Font name: google sans
Font size: 15
Font weight: 500
Font color: #7B5FC7
Space: 12

### Quotes
Padding left: 4
#### Marker
Bar width: 3
Bar color: #CDB8F3
Space: 16
Aside: yes

### Image Cards
<!-- The groceries band: the photo with a soft warm veil, so the copy reads. -->
Corner radius: 0
Padding: 80
Horizontal align: Center
Spacer large: 72
Background gradient:
- Ratios:
  - 0.0
  - 1.0
- Colors:
  - #2A272566
  - #2A272566

### Fixed styles

#### Section title
<!-- This page's titled sections ("It's not about ordering more."...): no card. -->
Padding: 0
Spacing: 22
Image corner radius: 32

#### Hero
<!-- A cream band that warms to lavender, as a soft glow. -->
Background color: #F6F2FB
Background gradient:
- Type: Linear
- Ratios:
  - 0.0
  - 0.6
  - 1.0
- Colors:
  - #FBFAF7
  - #F3EEFB
  - #FBFAF7
- Parameters:
  - Start: 0.5, 0.0
  - End: 0.5, 1.0
Padding top: 24
Padding bottom: 96
Padding left: 40
Padding right: 40
Spacing: 28
Horizontal align: Center

#### Plain
Orphan row: Center
Background color: #FBFAF7
Padding top: 88
Padding bottom: 88
Padding left: 48
Padding right: 48
Spacing: 36
Horizontal align: Center

#### Split
Image corner radius: 32
Background color: #FBFAF7
Padding top: 96
Padding bottom: 96
Padding left: 64
Padding right: 64
Spacing: 36
Horizontal align: Left
Vertical align: Center

#### Split lavender
Image corner radius: 32
Background color: #F3EEFB
Padding top: 96
Padding bottom: 96
Padding left: 64
Padding right: 64
Spacing: 36
Horizontal align: Left
Vertical align: Center

#### Gift
Background color: #F3EEFB
Padding top: 88
Padding bottom: 88
Padding left: 48
Padding right: 48
Spacing: 36
Horizontal align: Center
Image corner radius: 28

#### Stats
<!-- 12k+ | 4.9: two figures side by side, a hairline between them. -->
Background color: #F7F5F2
Padding top: 96
Padding bottom: 96
Padding left: 48
Padding right: 48
Spacing: 0
Horizontal align: Center

#### Stat lavender
Padding top: 0
Padding bottom: 0
Padding left: 56
Padding right: 56
Spacing: 6
Stroke width: 0
##### Display
- Font color: #C9B3F0
##### Text
- Font color: #7B756F

#### Stat blue
Padding top: 0
Padding bottom: 0
Padding left: 56
Padding right: 56
Spacing: 6
##### Display
- Font color: #B9C6EC
##### Text
- Font color: #7B756F

#### Faq row
<!-- The FAQ rows: white cards with a hairline edge. -->
Background color: #FFFFFF
Corner radius: 28
Padding top: 26
Padding bottom: 26
Padding left: 44
Padding right: 36
Spacing: 18
Stroke width: 1
Stroke color: #EFEBE6
Vertical align: center

#### Faq
Background color: #FBFAF7
Padding top: 96
Padding bottom: 96
Padding left: 160
Padding right: 160
Spacing: 28
Horizontal align: Left

#### Footer
Background color: #EEE9F5
Padding top: 64
Padding bottom: 40
Padding left: 48
Padding right: 48
Spacing: 20
Horizontal align: Left

## Text Styles

Heading1
- Font Name: google sans
- Font size: 54
- Font weight: 700
- Font color: #2A2725
- Marker text color: #B79CEB

Heading2
- Font Name: google sans
- Font size: 44
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Heading3
- Font Name: google sans
- Font size: 22
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Heading4
- Font Name: google sans
- Font size: 24
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Heading5
- Font Name: google sans
- Font size: 17
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Heading6
- Font Name: google sans
- Font size: 15
- Font weight: 700
- Font color: #2A2725
- Marker text color: #B79CEB

Text
- Font Name: google sans
- Font size: 17
- Font weight: 400
- Font color: #2A2725
- Marker text color: #B79CEB

Muted
- Font Name: google sans
- Font size: 13
- Font weight: 400
- Font color: #7B756F
- Marker text color: #B79CEB

Lead
- Font Name: google sans
- Font size: 19
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Display
- Font Name: google sans
- Font size: 64
- Font weight: 500
- Font color: #2A2725
- Marker text color: #B79CEB

Labels
- Font Name: google sans
- Font size: 12
- Font weight: 400
- Font color: #7B756F

<!-- Primary: the lavender pill, "Start your first order". -->
Links
- Font Name: google sans
- Font size: 16
- Font weight: 500
- Font color: #2A2725

<!-- Secondary: the white outlined pill, "How it works", "Join". -->
Links Secondary
- Font Name: google sans
- Font size: 16
- Font weight: 500
- Font color: #2A2725

<!-- Tertiary: plain text links in the footer. -->
Links Tertiary
- Font Name: google sans
- Font size: 14
- Font weight: 400
- Font color: #2A2725

Links Quinary
- Font Name: google sans
- Font size: 14
- Font weight: 500
- Font color: #2A2725

Links Senary
- Font Name: google sans
- Font size: 14
- Font weight: 500
- Font color: #2A2725

Links Septenary
- Font Name: google sans
- Font size: 12
- Font weight: 500
- Font color: #5B4A8A

<!-- Text: "Start riding ➡️" under each intro card. -->
Links Text
- Font Name: google sans
- Font size: 15
- Font weight: 500
- Font color: #7B5FC7

## Links

### Primary
Corner radius: 999
Fill color: #CDB8F3
Disabled fill color: #F1ECFA
Disabled text color: #B3ABC2
Padding top: 16
Padding bottom: 16
Padding left: 34
Padding right: 34
Stroke width: 0

### Secondary
Corner radius: 999
Fill color: #FFFFFF
Padding top: 16
Padding bottom: 16
Padding left: 34
Padding right: 34
Stroke width: 1
Stroke color: #E8E3DD

### Tertiary
Corner radius: 0
Fill color: #00000000
Padding top: 6
Padding bottom: 6
Padding left: 0
Padding right: 0
Stroke width: 0

### Quinary
<!-- The small ladder: `_[…]_` main action small, `__[…]__` second action small,
     `___[…]___` extra small. -->
Corner radius: 999
Fill color: #CDB8F3
Padding top: 9
Padding bottom: 9
Padding left: 18
Padding right: 18
Stroke width: 0
Emoji gap: 6

### Senary
Corner radius: 999
Fill color: #FFFFFF
Padding top: 9
Padding bottom: 9
Padding left: 18
Padding right: 18
Stroke width: 1
Stroke color: #E8E3DD
Emoji gap: 6

### Septenary
Corner radius: 999
Fill color: #F3EEFB
Padding top: 6
Padding bottom: 6
Padding left: 12
Padding right: 12
Stroke width: 0
Emoji gap: 4

### Text
Corner radius: 0
Fill color: #00000000
Padding top: 8
Padding bottom: 8
Padding left: 0
Padding right: 0
Stroke width: 0

### Inline
Text color: #7B5FC7
Underline: no

## Inline Code
<!-- Chips: `Tag` a lavender pill, *`Tag`* powder blue, **`Tag`** an outline. -->
Fill color: #F1ECFA
Corner radius: 999
Padding top: 5
Padding bottom: 5
Padding left: 12
Padding right: 12
Stroke width: 0
Disabled fill color: #F5F3F0
Disabled text color: #B3ABC2

### Secondary
Fill color: #E9EEFA

### Tertiary
Fill color: #FFFFFF
Stroke width: 1
Stroke color: #E8E3DD

## Color Replacements
<!-- Only the groceries photo band needs one: its copy sits on a picture. -->
On background color: image
- Replacement: #FFFFFF
- Text color: #2A2725, Replacement: #FFFFFF
- Text color: #7B756F, Replacement: #FFFFFFD9

## Horizontal Rule
Stroke color: #E8E3DD
Stroke width: 1

## Separators
Dash: hide
Bullet: hide
Bar: hide

## Vertical Rule
Draw: no

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

### Primary
<!-- The intro cards' icons: a lavender glyph on a pale lavender circle. -->
Icon size: 30
Padding: 22
Shape: circle
Background color: #F3EEFB
Icon color: #7B5FC7

### Text
Color: #7B5FC7

### Link
Color: #7B5FC7
<!-- (the FAQ plus takes its button's grey label colour) -->

### Inline
Color: #7B5FC7

## Fonts
- assets/fonts/GoogleSans-Regular.ttf
- assets/fonts/GoogleSans-Italic.ttf
- assets/fonts/GoogleSans-Medium.ttf
- assets/fonts/GoogleSans-MediumItalic.ttf
- assets/fonts/GoogleSans-SemiBold.ttf
- assets/fonts/GoogleSans-SemiBoldItalic.ttf
- assets/fonts/GoogleSans-Bold.ttf
- assets/fonts/GoogleSans-BoldItalic.ttf

## Tables

### Table
Merge rows: yes
Background color: #FFFFFF
Corner radius: 24
Padding: 8
Stroke width: 1
Stroke color: #EFEBE6
Stacking cards: yes
Card layout: title

### Header
Background color: #00000000
Padding: 12
- Font name: google sans
- Font size: 13
- Font weight: 500
- Font color: #7B756F

### Cells
Background color: #00000000
Padding: 12
- Font name: google sans
- Font size: 15
- Font color: #2A2725

## Images

### Placeholders

#### Avatar
Fill color:
- #EDE5FB
- #E3EAF9
- #F6EAF0
Text color: #5B4A8A
Text style: Text

#### Missing
Fill color: #F3EEFB
Text color: #B79CEB
Icon: 🖼️
Icon size: 22%

#### Broken
Fill color: #F3EEFB
Text color: #B79CEB
Icon: 🖼️
Icon size: 22%

## Drawing elements

### Key Value Bars
Thickness: 8
Corner radius: 4
Background color: #B79CEB

### Key Value Bar Track
Background color: #EEE9F5
Corner radius: 4

### Ratio Bars
Thickness: 8
Corner radius: 4
Background color: #B79CEB

### Ratio Bar Track
Background color: #EEE9F5
Corner radius: 4

### Dates
Fill: single
Spacing: 2
Background color: #F3EEFB
Corner radius: 18
Padding: 12

### Date Key
- Font Name: google sans
- Font size: 12
- Font weight: 500
- Font color: #7B5FC7

### Date Day
- Font Name: google sans
- Font size: 24
- Font weight: 500
- Font color: #2A2725

### Task controls
Type: checkbox
Size: 26
Padding: 3
Corner radius: 8
Space: 12

### Checked outer
Background color: #B79CEB
### Checked inner
Background color: #B79CEB
Symbol: ✓
Symbol color: #FFFFFF
### Unchecked outer
Background color: #FFFFFF
Stroke color: #D9D2E6
Stroke width: 1.5
### Unchecked inner
Background color: #FFFFFF

### Sliders
Style: line
Thickness: 8
Circle diameter: 24

### Slider Track
Background color: #EEE9F5

### Slider Bar
Background color: #B79CEB

### Slider Handle
Background color: #FFFFFF
Stroke width: 1.5
Stroke color: #B79CEB

## Charts
Bar thickness: 18
Corner radius: 9
Background color: #B79CEB
Negative color: #E9B9C1

### Line Chart
Height: 72
Line width: 2.5
Line color: #9C82E0
Point size: 6
Background color: #B79CEB26

### Chart Labels
- Font size: 12
- Font color: #7B756F
