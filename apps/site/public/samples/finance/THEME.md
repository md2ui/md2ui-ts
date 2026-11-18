# Night ledger

<!-- A personal finance dashboard after dark: ink cards on a near-black page, figures in
     Space Mono, mint for money in and for the bars, coral for money out, a violet line.
     Any `##` is a card, so other samples' content reads here too.

     Palette:
       #0B0F14  page
       #141A22  card
       #1B2330  panel, tile, chip
       #263040  rims and rules
       #E8EDF4  headings and figures
       #8A96A8  body and captions
       #5E6A7D  labels
       #4ADE9B  mint: bars, money in, the main action
       #FF6B6B  coral: money out
       #8B7CF6  violet: the earnings line -->

## Fonts
- assets/fonts/Inter_18pt-Regular.ttf
- assets/fonts/Inter_18pt-Medium.ttf
- assets/fonts/Inter_18pt-SemiBold.ttf
- assets/fonts/Inter_18pt-Bold.ttf
- assets/fonts/SpaceMono-Regular.ttf
- assets/fonts/SpaceMono-Bold.ttf

## Styling & Spacing

### Root
Layout: Auto
Background color: #0B0F14
Padding: 32
Spacing: 20
Horizontal align: Default

### Elements
Row spacing: 10
Col spacing: 8
Group spacing: 18
Image distance: 12
Padding: 0

### Heading 1
Padding: 0
Spacing: 24

### Heading 2
<!-- Every `##` is an ink card with a hairline rim. -->
Background color: #141A22
Corner radius: 24
Padding: 26
Spacing: 18
Stroke width: 1
Stroke color: #263040
Row spacing: 20
Col spacing: 20
Merge rows: no

### Heading 3
<!-- A panel inside a card. -->
Background color: #1B2330
Corner radius: 16
Padding: 18
Spacing: 12
#### Display
- Font size: 28

### Heading 4
<!-- The three-up KPI tiles. -->
Background color: #1B2330
Corner radius: 14
Padding: 14
Spacing: 4

### Numbered Lists
#### Marker
Number format: 01
Font name: Space Mono
Font size: 12
Font color: #5E6A7D
Space: 12

## Text Styles

Heading2
- Font Name: Inter 18pt
- Font size: 20
- Font weight: 700
- Font color: #E8EDF4

Heading3
- Font Name: Inter 18pt
- Font size: 15
- Font weight: 600
- Font color: #E8EDF4

Text
- Font Name: Inter 18pt
- Font size: 14
- Font weight: 400
- Font color: #8A96A8

Muted
- Font Name: Inter 18pt
- Font size: 12
- Font weight: 400
- Font color: #5E6A7D

Lead
- Font Name: Space Mono
- Font size: 20
- Font weight: 700
- Font color: #E8EDF4

<!-- The big figures: $24,318.60, $15,830.32. -->
Display
- Font Name: Space Mono
- Font size: 36
- Font weight: 700
- Font color: #E8EDF4

Labels
- Font Name: Inter 18pt
- Font size: 11
- Font weight: 500
- Font color: #5E6A7D

Inline Code
- Font Name: Inter 18pt
- Font size: 12
- Font weight: 600
- Font color: #E8EDF4

Links
- Font Name: Inter 18pt
- Font size: 13
- Font weight: 700
- Font color: #0B0F14

Links Secondary
- Font Name: Inter 18pt
- Font size: 13
- Font weight: 600
- Font color: #E8EDF4

Links Text
- Font Name: Inter 18pt
- Font size: 13
- Font weight: 600
- Font color: #8A96A8

## Links

### Primary
<!-- The selected range, the main action: a mint pill. -->
Fill color: #4ADE9B
Corner radius: 20
Padding top: 8
Padding bottom: 8
Padding left: 16
Padding right: 16
Stroke width: 0
Emoji gap: 8

### Secondary
<!-- The other ranges: an ink pill with a rim. -->
Fill color: #1B2330
Corner radius: 20
Padding top: 8
Padding bottom: 8
Padding left: 16
Padding right: 16
Stroke width: 1
Stroke color: #263040

### Text
Fill color: #00000000
Padding: 4

### Inline
Text color: #4ADE9B
Underline: no

## Inline Code
<!-- `This week 🔽`, `Sample data`: a panel chip with a rim. -->
Corner radius: 10
Padding top: 6
Padding bottom: 6
Padding left: 12
Padding right: 12
Fill color: #1B2330
Stroke color: #263040
Stroke width: 1

## Fixed colors

### Emoji
<!-- The change chips: coral down, mint up. -->
- ⮋ #FF6B6B datapoints
- ⮉ #4ADE9B datapoints

### Datapoints
<!-- Money in (+$5,000.00) is mint, money out coral. -->
- change up: #4ADE9B
- change down: #FF6B6B

## Horizontal Rule
Stroke color: #263040
Stroke width: 1

## Separators
Dash: hide
Bullet: show
Bar: hide

## Vertical Rule
Draw: no

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

### Primary
Icon size: 18
Icon color: #E8EDF4
Padding: 9
Background colors:
- #1B2330
Corner radius: 12
Shape: square

### Text
Color: #8A96A8

## Datapoints

### Dates
<!-- "Nov 4, 9:17 PM" is a timestamp, not a day to schedule: no day chip. -->
Enabled: no

### Key Value Bars
Enabled: yes
Position: below
Thickness: 22
Corner radius: 6
Background color: #4ADE9B

### Key Value Bar Track
Background color: #1B2330
Corner radius: 6

### Emphasis
Enabled: yes

## Drawing elements

### Unit Ratios
<!-- The budget: spent over planned, as a ring. -->
Enabled: yes
Style: ring
Show total: yes
Show key: yes

### Ring
Thickness: 12
Diameter: 96
Background color: #4ADE9B
- Font color: #E8EDF4

### Ring Track
Background color: #1B2330

## Charts
Enabled: yes
Bar thickness: 22
Bar width: fill
Bar spacing: 28
Corner radius: 6
Background color: #4ADE9B

### Chart Track
Background color: #1B2330

### Chart Labels
- Font size: 12
- Font color: #5E6A7D

### Chart Grid
Axis labels: yes
Horizontal lines: yes
Ticks: 4
Line color: #263040
Line dash: 4 4
- Font size: 12
- Font color: #5E6A7D

### Line Chart
<!-- Earnings: a violet line over a fading violet area. -->
Height: 170
Line width: 2
Line color: #8B7CF6
Point size: 0
Background gradient:
- Colors:
  - #8B7CF655
  - #8B7CF608

### Chart Values
- Font size: 11
- Font weight: 600
- Font color: #E8EDF4
