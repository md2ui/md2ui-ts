# Hardstop brutalist

<!-- Base: HARDSTOP (p.superdesign.dev_draft_1a57fa51…png). Cream paper, 3px ink borders,
hard offset ink shadows with no blur, Archivo Black display type, JetBrains Mono labels.
Acid #EDFF54 is the one accent. Bands: cream, beige, ink, acid.

Button wrappers, as this page uses them:
  [x]      Primary   acid, medium        _[x]_    acid, small
  *[x]*    Secondary paper               __[x]__  acid, large
  **[x]**  Tertiary  ink (inverse)       ___[x]___ paper, flat
  ***[x]*** Quaternary ghost (outline only)
Chips: `x` acid label, *`x`* ink section number, **`x`** ink avatar initials. -->

## Fonts
- assets/fonts/Archivo-Regular.ttf
- assets/fonts/Archivo-Medium.ttf
- assets/fonts/Archivo-SemiBold.ttf
- assets/fonts/Archivo-Bold.ttf
- assets/fonts/Archivo-ExtraBold.ttf
- assets/fonts/Archivo-Black.ttf
- assets/fonts/JetBrainsMono-Regular.ttf
- assets/fonts/JetBrainsMono-Medium.ttf
- assets/fonts/JetBrainsMono-Bold.ttf

## Styling & Spacing

### Root
Layout: Auto
Background color: #F2EFE8
Padding: 0
Spacing: 0
Max width: 1440
Stack sections: yes
#### Text
- Marker text color: #0A0A0A
- Marker background color: #EDFF54
#### Lead
- Font name: Archivo
- Font weight: 600
#### Display
- Font name: Archivo
- Font weight: 900

<!-- A cream band. The colour bands are fixed styles below. -->
### Heading 1
Background color: #F2EFE8
Padding top: 72
Padding bottom: 72
Padding left: 64
Padding right: 64
Spacing: 40
Stroke width: 3
Stroke color: #0A0A0A

### Heading 2
<!-- Any `## ` is a paper card that casts the hard shadow, as `#### Paper` does. This
     page's own section titles keep their plain look with `{#section-title-n}`. -->
Background color: #F7F5EF
Stroke width: 3
Stroke color: #0A0A0A
Stroke align: inside
Corner radius: 0
Padding: 24
Spacing: 18
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #0A0A0A

### Heading 3
<!-- The specimen panel: paper, 3px ink rim, content centred. -->
Background color: #F7F5EF
Stroke width: 3
Stroke color: #0A0A0A
Stroke align: inside
Corner radius: 0
Padding: 32
Spacing: 12
Horizontal align: Center

### Image Cards
<!-- A card drawn over a photo (content in an image's alt slot): its copy sits
     inside it as a band's does. -->
Padding top: 72
Padding bottom: 72
Padding left: 64
Padding right: 64
Corner radius: 0

### Elements
Row spacing: 10
Col spacing: 10
Group row spacing: 20
Group col spacing: 24

<!-- The live-preview window: a quote, so it can sit in a `:::` cell. -->
### Quotes
Background color: #F7F5EF
Stroke width: 3
Stroke color: #0A0A0A
Stroke align: inside
Padding: 28
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #0A0A0A

<!-- Stat tiles: paper, acid, ink, paper, dealt per item. -->
### Unordered Lists
Background colors:
- #F7F5EF
- #EDFF54
- #0A0A0A
- #F7F5EF
Stroke width: 3
Stroke color: #0A0A0A
Stroke align: inside
Padding: 28
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #0A0A0A
#### Display
- Font name: Archivo
- Font size: 56
- Font weight: 900

### Fixed styles

<!-- Colour bands: a Heading 1 band in another colour. -->
#### Beige band
Mode: override
Background color: #E6E1D5

#### Ink band
Mode: override
Background color: #0A0A0A

#### Acid band
Mode: override
Background color: #EDFF54

<!-- This page's section titles ("01 / Anatomy"...): no card, as before. -->
#### Section title
Padding: 0
Spacing: 32

<!-- Cards that cast the hard shadow. -->
#### Paper
Mode: override
Horizontal align: Left
Padding: 24
Spacing: 18
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #0A0A0A

#### Acid
Mode: override
Background color: #EDFF54
Horizontal align: Left
Padding: 24
Spacing: 18
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #0A0A0A

#### Ink
Mode: override
Background color: #0A0A0A
Horizontal align: Left
Padding: 24
Spacing: 18
Outer shadow:
- Offset x: 8
- Offset y: 8
- Radius: 0
- Color: #EDFF54

## Code Blocks
Background color: #0A0A0A
Corner radius: 0
Padding: 24
Line spacing: 6

## Text Styles

Text
- Font Name: JetBrains Mono
- Font size: 14
- Font color: #2A2A2A

Heading1
- Font Name: Archivo
- Font size: 64
- Font weight: 900
- Font color: #0A0A0A

Heading2
- Font Name: Archivo
- Font size: 32
- Font weight: 900
- Font color: #0A0A0A

Heading3
- Font Name: Archivo
- Font size: 18
- Font weight: 800
- Font color: #0A0A0A

Muted
- Font Name: JetBrains Mono
- Font size: 11
- Font color: #6B6B66

Lead
- Font Name: Archivo
- Font size: 21
- Font weight: 600
- Font color: #0A0A0A

<!-- #0B0B0B, not ink, so an ink surface can turn the big number acid alone. -->
Display
- Font Name: Archivo
- Font size: 80
- Font weight: 900
- Font color: #0B0B0B

Links
- Font Name: Archivo
- Font size: 15
- Font weight: 700
- Font color: #0A0A0A

Links Secondary
- Font Name: Archivo
- Font size: 15
- Font weight: 700
- Font color: #0A0A0A

Links Tertiary
- Font Name: Archivo
- Font size: 15
- Font weight: 700
- Font color: #F7F5EF

Links Quaternary
- Font Name: Archivo
- Font size: 15
- Font weight: 700
- Font color: #0A0A0A

Links Quinary
- Font Name: Archivo
- Font size: 12
- Font weight: 700
- Font color: #0A0A0A

Links Senary
- Font Name: Archivo
- Font size: 19
- Font weight: 800
- Font color: #0A0A0A

Links Septenary
- Font Name: Archivo
- Font size: 15
- Font weight: 700
- Font color: #0A0A0A

Links Text
- Font Name: JetBrains Mono
- Font color: #0A0A0A

Inline Code
- Font Name: JetBrains Mono
- Font size: 11
- Font weight: 700
- Font color: #0A0A0A

Inline Code Secondary
- Font color: #F7F5EF

Inline Code Tertiary
- Font size: 15
- Font color: #EDFF54

Code Block
- Font Name: JetBrains Mono
- Font size: 13
- Font color: #F2EFE8

## Links
Corner radius: 0
Padding top: 14
Padding bottom: 14
Padding left: 24
Padding right: 24
Emoji gap: 10
Emoji shape: square
Fill color: #EDFF54
Stroke width: 3
Stroke color: #0A0A0A
Stroke align: inside
Disabled fill color: #F4F8C2
Disabled text color: #A3A38F
Disabled stroke color: #0A0A0A33
Outer shadow:
- Offset x: 5
- Offset y: 5
- Radius: 0
- Color: #0A0A0A

### Secondary
Fill color: #F7F5EF

### Tertiary
Fill color: #0A0A0A

### Quaternary
Fill color: #00000000

### Quinary
Stroke width: 2
Padding top: 7
Padding bottom: 7
Padding left: 12
Padding right: 12

### Senary
Stroke width: 4
Padding top: 18
Padding bottom: 18
Padding left: 32
Padding right: 32
Outer shadow:
- Offset x: 7
- Offset y: 7
- Radius: 0
- Color: #0A0A0A

### Septenary
Fill color: #F7F5EF

### Text
Fill color: #00000000
Padding: 6

### Inline
Text color: #0A0A0A
Underline: yes

## Inline Code
Fill color: #EDFF54
Stroke width: 2
Stroke color: #0A0A0A
Stroke align: inside
Corner radius: 0
Padding top: 6
Padding bottom: 6
Padding left: 10
Padding right: 10
Outer shadow:
- Offset x: 3
- Offset y: 3
- Radius: 0
- Color: #0A0A0A

### Secondary
Fill color: #0A0A0A
Outer shadow:
- Offset x: 0
- Offset y: 0
- Radius: 0
- Color: #00000000

### Tertiary
Fill color: #0A0A0A
Padding: 14

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

### Primary
Shape: square
Size: 20
Padding: 8
Icon color: #0A0A0A
Background color: #EDFF54

## Separators
Dash: hide
Bullet: show

## Horizontal Rule
Stroke width: 3
Stroke color: #D4D0C6

## Tables

### Table
Merge rows: yes
Background color: #F7F5EF
Stroke width: 3
Stroke color: #0A0A0A
Corner radius: 0
Row spacing: 0
Col spacing: 0
Stacking cards: yes
Card layout: title

### Header
Background color: #F7F5EF
Padding: 18
- Font name: JetBrains Mono
- Font size: 11
- Font weight: 700
- Font color: #0A0A0A

### Cells
Background color: #F7F5EF
Stroke width: 1
Stroke color: #0A0A0A
Padding: 22
- Font name: JetBrains Mono
- Font size: 11
- Font color: #0A0A0A

### Card Keys
Key spacing: 6
- Font name: JetBrains Mono
- Font size: 10
- Font color: #6B6B66

## Fixed colors

### Buttons
#### Contains
- Destructive: Fill color: #FFC2C2

## Color Replacements

<!-- Ink surfaces: cream text, acid in place of ink fills (avatar chips, section chips). -->
On background color: #0A0A0A
- Replacement: #F2EFE8
- Text color: #0B0B0B, Replacement: #EDFF54
- Text color: #EDFF54, Replacement: #EDFF54
- Text color: #6B6B66, Replacement: #9C9C94
- Fill color: #0A0A0A, Replacement: #EDFF54
- Stroke color: #D4D0C6, Replacement: #3A3A36

<!-- Beige bands: the section chip turns acid, as on the reference. -->
On background color: #E6E1D5
- Fill color: #0A0A0A, Replacement: #EDFF54

<!-- An acid surface: a label that was cream (an ink chip turned acid) reads ink. -->
On background color: #EDFF54
- Text color: #F7F5EF, Replacement: #0A0A0A
- Text color: #EDFF54, Replacement: #0A0A0A
- Text color: #6B6B66, Replacement: #4A4C1E
- Stroke color: #D4D0C6, Replacement: #0A0A0A33
