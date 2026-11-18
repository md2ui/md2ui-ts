# md2ui home

<!-- The md2ui landing page (a 1440px page: render at --width 1344, the theme's
     48px page padding brings it to 1440). A #00E700 green page; white cards
     with a 3px black outline and a hard black drop to the bottom right; Inter for
     the 48 and 24pt titles, IBM Plex Mono for the 14pt body; in-text `code` in the
     green; chips and icon tiles in the green at 10% over white. -->

## Fonts
- assets/fonts/Inter_24pt-Regular.ttf
- assets/fonts/Inter_24pt-Medium.ttf
- assets/fonts/Inter_24pt-SemiBold.ttf
- assets/fonts/Inter_24pt-Bold.ttf
- assets/fonts/IBMPlexMono-Regular.ttf
- assets/fonts/IBMPlexMono-Medium.ttf
- assets/fonts/IBMPlexMono-SemiBold.ttf
- assets/fonts/IBMPlexMono-Bold.ttf

## Styling & Spacing

### Root
Layout: Auto
Background color: #00E700
Padding: 48
Padding top: 24
Max width: 1344
Spacing: 64

### Elements
Row spacing: 16
Col spacing: 8
Group spacing: 24

### Heading 1
Padding: 0
Spacing: 40

### Heading 2
<!-- Every `## ` is the clay-free card: white, 3px black outline, a hard black drop.
     The page's other `## ` sections (terminal, quick cards, boundary columns) keep
     their own fixed styles. -->
Background color: #FFFFFF
Corner radius: 24
Padding: 38
Spacing: 50
Stroke width: 3
Stroke color: #000000
Outer shadow:
- Offset x: 6
- Offset y: 6
- Color: #000000
- Radius: 0

### Heading 3
Padding: 0
Spacing: 24

### Quotes
#### Marker
Quote char: >
Font name: IBM Plex Mono
Font size: 14
Font color: #000000
Space: 8
Aside: yes

### Image Cards
<!-- A card drawn over a photo (content in an image's alt slot): the copy sits
     inside it, and its corners round like the white cards'. -->
Corner radius: 24
Padding: 48

### Fixed styles

#### Terminal
<!-- "How it works?": the black terminal panel inside the workflow card. -->
Background color: #000000
Padding: 32
Spacing: 40

#### Hero
<!-- The white hero card: logo and note on the left, the pitch on the right. -->
Background color: #FFFFFF
Corner radius: 40
Padding: 72
Spacing: 50
Vertical align: center

#### Feature band
<!-- "Design very customizable": straight on the green, its cards in a row. -->
Padding: 0
Spacing: 50
##### Display
- Marker text color: #FFFFFF

#### Workflow
<!-- "How it works?": a card whose body is a black terminal panel. -->
Background color: #FFFFFF
Corner radius: 32
Padding: 28
Spacing: 20
Stroke width: 3
Stroke color: #000000
Outer shadow:
- Offset x: 6
- Offset y: 6
- Color: #000000
- Radius: 0
##### Text
- Font color: #FFFFFF
- Marker text color: #00E700

#### Quick start
Padding: 0
Spacing: 50
##### Display
- Marker text color: #FFFFFF

#### Quick card
Background color: #FFFFFF
Corner radius: 24
Padding: 38
Spacing: 24
Stroke width: 3
Stroke color: #000000
Outer shadow:
- Offset x: 6
- Offset y: 6
- Color: #000000
- Radius: 0

#### Boundaries
<!-- "Three separated boundaries": a white card, no outline. -->
Background color: #FFFFFF
Corner radius: 40
Padding: 58
Spacing: 40

#### Boundary column
Padding: 0
Spacing: 32

#### Boundary title
<!-- 01. / 02. / 03.: the green at 10% over the white card. -->
Background color: #00E7001A
Corner radius: 24
Padding: 36
Spacing: 12
##### Display
- Font color: #00E700

#### Adaptive
Padding: 0
Spacing: 50
##### Display
- Marker text color: #FFFFFF

#### Footer
Padding: 0
Spacing: 40

## Text Styles

Text
- Font Name: IBM Plex Mono
- Font size: 14
- Font weight: 400
- Font color: #000000
- Marker text color: #00E700

Display
- Font Name: Inter 24pt
- Font size: 48
- Font weight: 700
- Font color: #000000
- Marker text color: #00E700

Heading2
- Font Name: Inter 24pt
- Font size: 24
- Font weight: 600
- Font color: #000000

Lead
- Font Name: Inter 24pt
- Font size: 24
- Font weight: 600
- Font color: #000000

Muted
- Font Name: IBM Plex Mono
- Font size: 14
- Font color: #000000

Links
- Font Name: Inter 24pt
- Font size: 18
- Font weight: 600
- Font color: #FFFFFF

Links Secondary
- Font Name: Inter 24pt
- Font size: 18
- Font weight: 600
- Font color: #000000

Links Tertiary
- Font Name: IBM Plex Mono
- Font size: 14
- Font weight: 700
- Font color: #000000

Links Text
- Font Name: IBM Plex Mono
- Font size: 14
- Font weight: 700
- Font color: #000000

Inline Code
- Font Name: IBM Plex Mono
- Font size: 14
- Font color: #00C400

## Links

### Primary
<!-- See more, Learn more, Visit repo: black pills. -->
Fill color: #000000
Corner radius: 28
Padding top: 12
Padding bottom: 12
Padding left: 36
Padding right: 36
Stroke width: 0

### Secondary
<!-- Edit this page: the green pill. -->
Fill color: #00E700
Corner radius: 28
Padding top: 14
Padding bottom: 14
Padding left: 36
Padding right: 36
Emoji gap: 10

### Tertiary
<!-- `**[…]**`: a bold plain link (lists of links, footers). -->
Fill color: #00000000
Padding: 2
Corner radius: 0
Stroke width: 0

### Text
Padding: 0

### Inline
Text color: #00E700
Underline: yes

## Inline Code
<!-- Python, Typescript, Wire protocol: outlined green chips. -->
Fill color: #00E7001A
Stroke width: 1
Stroke color: #00E700
Corner radius: 4
Padding top: 4
Padding bottom: 4
Padding left: 12
Padding right: 12

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

### Primary
<!-- The feature icons: a green glyph on a green-at-10% square. -->
Icon size: 28
Padding: 16
Shape: square
Corner radius: 12
Background color: #00E7001A
Icon color: #00E700

### Text
Color: #000000

### Link
Color: #000000

## Separators
Dash: hide
Pipe: hide

## Horizontal Rule
Stroke color: #000000
Stroke width: 3

## Drawing elements

### Slider Track
Stroke width: 6
Stroke color: #000000

### Slider Handle
Background color: #000000

## Color Replacements

On background color: #00E700
- Text color: #00E700, Replacement: #000000
