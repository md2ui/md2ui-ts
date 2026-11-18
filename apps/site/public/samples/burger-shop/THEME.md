# Burger Shop

<!-- The Burger Shop web app. A pale lime page, white product cards with a light
border, Plus Jakarta Sans for headings, names and prices, Inter for everything read.
Palette (named beside each colour the first time it appears):

  forest   #2D4E3A  the brand: big buttons, headline band, Limited edition / Chef's Pick
  mustard  #E69F35  New, star ratings, the headline's call to action, success badge
  orange   #FF642D  Offer, liked heart, savings
  root     #F2FCD9  the page
  cream    #F9F3EB  (249, 243, 235) the quiet icon buttons and tags: forest on the lime page
  cream2   #F8F2EA  the same cream for surfaces that keep it everywhere: the cart summary,
                    bar tracks, code blocks, icon badges
  ink      #1C2B22  titles and prices      body #4A5A50      muted #7A887E
  border   #E3EBD3  card rims and rules
  tints    forest #DCE8DF / mustard #FBEBD0 / orange #FFE3D8 -->

## Fonts
- assets/fonts/PlusJakartaSans-Medium.ttf
- assets/fonts/PlusJakartaSans-SemiBold.ttf
- assets/fonts/PlusJakartaSans-Bold.ttf
- assets/fonts/PlusJakartaSans-ExtraBold.ttf
- assets/fonts/Inter_18pt-Regular.ttf
- assets/fonts/Inter_18pt-Medium.ttf
- assets/fonts/Inter_18pt-SemiBold.ttf
- assets/fonts/Inter_18pt-Bold.ttf

## Styling & Spacing

### Root
Background color: #F2FCD9
Padding: 20
Spacing: 28
Max width: 1120
Vertical align: Center
Layout: Auto
Stack sections: yes
Spacer small: 8
Spacer medium: 16
Spacer large: 32

### Heading 1
Padding: 0
Spacing: 16

<!-- A ## is a white panel with a light rim and a soft lift. This page's own titled
     blocks (Your orders, Recommended for you...) sit flat with `{#shop-section-n}`. -->
### Heading 2
Background color: #FFFFFF
Corner radius: 24
Padding: 24
Spacing: 16
Stroke width: 1
Stroke color: #E3EBD3
Outer shadow:
- Offset y: 2
- Radius: 10
- Color: #2D4E3A0D

<!-- A ### is a white card with a light rim: one product. Its photo bleeds to the rim. -->
### Heading 3
Background color: #FFFFFF
Corner radius: 22
Padding: 14
Spacing: 10
Image bleed: yes
Stroke width: 1
Stroke color: #E3EBD3
Outer shadow:
- Offset y: 2
- Radius: 10
- Color: #2D4E3A0D
#### Display
- Font name: Plus Jakarta Sans
- Font size: 18
- Font weight: 800
- Font color: #1C2B22
#### Lead
- Font name: Plus Jakarta Sans
- Font size: 16
- Font weight: 700
- Font color: #1C2B22

<!-- A #### is a plain white panel: an empty state, a result. -->
### Heading 4
Background color: #FFFFFF
Corner radius: 24
Padding: 24
Spacing: 12
Stroke width: 1
Stroke color: #E3EBD3

### Image Cards
Corner radius: 22
Padding: 14
Spacing: 10
Content valign: top
Spacer large: 120

### Elements
Row spacing: 8
Col spacing: 10
Group spacing: 14
Image row spacing: 12
Image col spacing: 12

<!-- A list is one white card, a light rule between its rows: the cart, the order updates. -->
### Unordered Lists
Vertical align: Center
Merge rows: yes
Background color: #FFFFFF
Corner radius: 22
Padding: 14
Stroke width: 1
Stroke color: #E3EBD3
#### Horizontal Rule
Stroke color: #E3EBD3
Stroke width: 1

### Numbered Lists
Padding top: 6
Padding bottom: 6
#### Marker
Number format: 1
Space: 10
Font name: Plus Jakarta Sans
Font size: 15
Font weight: 800
Font color: #2D4E3A
Aside: yes
Alignment: baseline

### Fixed styles

<!-- This page's titled blocks: flat on the page, as before. -->
#### Shop section
Padding: 0
Spacing: 16

<!-- The home headline band: forest green, the burger beside the words. -->
#### Headline
Padding: 32
Spacing: 14
Corner radius: 32
Background color: #2D4E3A
Vertical align: Center
##### Display
- Font name: Plus Jakarta Sans
- Font size: 40
- Font weight: 800
- Font color: #FFFFFF

<!-- The three promo cards under the headline. Each one takes the next colour:
forest, mustard, orange. -->
#### Offer
Padding: 20
Spacing: 8
Corner radius: 26
Background colors:
- #2D4E3A
- #E69F35
- #FF642D
Vertical align: Center
##### Display
- Font name: Plus Jakarta Sans
- Font size: 20
- Font weight: 800
- Font color: #FFFFFF

<!-- The cart's totals: a cream panel under the rows (Subtotal, Delivery, Total). -->
#### Summary
Padding: 20
Spacing: 10
Corner radius: 22
Background color: #F8F2EA
##### Display
- Font name: Plus Jakarta Sans
- Font size: 24
- Font weight: 800
- Font color: #1C2B22

<!-- The order-tracking card on the home page when an order is running. -->
#### Track
Padding: 18
Spacing: 10
Corner radius: 22
Background color: #FFFFFF
Stroke width: 1
Stroke color: #E3EBD3

<!-- The head of the order status page: the big badge, the status, the progress. -->
#### Status
Padding: 28
Spacing: 10
Corner radius: 28
Horizontal align: Center
Background color: #FFFFFF
Stroke width: 1
Stroke color: #E3EBD3
##### Display
- Font name: Plus Jakarta Sans
- Font size: 28
- Font weight: 800
- Font color: #1C2B22

<!-- The payment-successful sheet (references/file.webp, its content without the modal). -->
#### Success
Padding: 32
Spacing: 12
Corner radius: 32
Horizontal align: Center
Background color: #FFFFFF
Stroke width: 1
Stroke color: #E3EBD3
Outer shadow:
- Offset y: 8
- Radius: 28
- Color: #2D4E3A1A
##### Display
- Font name: Plus Jakarta Sans
- Font size: 36
- Font weight: 800
- Font color: #1C2B22

<!-- A question the customer answers before something that cannot be undone: cancelling
an order. Centred, white, like the success sheet. -->
#### Sheet
Padding: 28
Spacing: 12
Corner radius: 28
Horizontal align: Center
Background color: #FFFFFF
Stroke width: 1
Stroke color: #E3EBD3
Outer shadow:
- Offset y: 8
- Radius: 28
- Color: #2D4E3A1A
##### Lead
- Font name: Plus Jakarta Sans
- Font size: 20
- Font weight: 800
- Font color: #1C2B22

<!-- An empty place (grocery-app reference): white, left aligned, the icon above a big
green title. -->
#### Empty
Padding: 28
Spacing: 12
Corner radius: 28
Background color: #FFFFFF
Stroke width: 1
Stroke color: #E3EBD3
##### Display
- Font name: Plus Jakarta Sans
- Font size: 28
- Font weight: 800
- Font color: #2D4E3A

## Text Styles

Text
- Font Name: Inter 18pt
- Font size: 14
- Font color: #4A5A50

Heading1
- Font Name: Plus Jakarta Sans
- Font size: 28
- Font weight: 800
- Font color: #1C2B22

Heading2
- Font Name: Plus Jakarta Sans
- Font size: 21
- Font weight: 800
- Font color: #1C2B22

Heading3
- Font Name: Plus Jakarta Sans
- Font size: 17
- Font weight: 700
- Font color: #1C2B22

Heading4
- Font Name: Plus Jakarta Sans
- Font size: 15
- Font weight: 700
- Font color: #1C2B22

Heading5
- Font Name: Plus Jakarta Sans
- Font size: 13
- Font weight: 700
- Font color: #4A5A50

Heading6
- Font Name: Inter 18pt
- Font size: 12
- Font weight: 600
- Font color: #7A887E

Muted
- Font Name: Inter 18pt
- Font size: 12
- Font color: #7A887E

Lead
- Font Name: Plus Jakarta Sans
- Font size: 16
- Font weight: 700
- Font color: #1C2B22

Display
- Font Name: Plus Jakarta Sans
- Font size: 34
- Font weight: 800
- Font color: #1C2B22

Key
- Font Name: Inter 18pt
- Font size: 12
- Font color: #7A887E

Value
- Font Name: Plus Jakarta Sans
- Font size: 15
- Font weight: 700
- Font color: #1C2B22

<!-- Big buttons: filled forest (bare) and outlined forest (*). -->
Links
- Font Name: Plus Jakarta Sans
- Font size: 15
- Font weight: 700
- Font color: #FFFFFF

Links Secondary
- Font Name: Plus Jakarta Sans
- Font size: 15
- Font weight: 700
- Font color: #2D4E3A

<!-- Medium buttons, inside a card: ** filled, *** outlined. -->
Links Tertiary
- Font Name: Plus Jakarta Sans
- Font size: 13
- Font weight: 700
- Font color: #FFFFFF

Links Quaternary
- Font Name: Plus Jakarta Sans
- Font size: 13
- Font weight: 700
- Font color: #2D4E3A

<!-- Small buttons at a row's edge: _ filled; __ the muted cream icon button (add, remove,
like). -->
Links Quinary
- Font Name: Plus Jakarta Sans
- Font size: 12
- Font weight: 700
- Font color: #FFFFFF

Links Senary
- Font Name: Plus Jakarta Sans
- Font size: 14
- Font weight: 700
- Font color: #1C2B22

Links Septenary
- Font Name: Plus Jakarta Sans
- Font size: 11
- Font weight: 700
- Font color: #2D4E3A

<!-- A text link: a product's name that opens its page, View more at a title's edge. -->
Links Text
- Font Name: Plus Jakarta Sans
- Font size: 16
- Font weight: 700
- Font color: #1C2B22

Inline Code
- Font Name: Inter 18pt
- Font size: 11
- Font weight: 700
- Font color: #4A5A50

Inline Code Secondary
- Font Name: Inter 18pt
- Font color: #2D4E3A

Inline Code Tertiary
- Font Name: Inter 18pt
- Font color: #1F5A35

Inline Code Quaternary
- Font Name: Inter 18pt
- Font color: #8A5410

Inline Code Quinary
- Font Name: Inter 18pt
- Font size: 10

Inline Code Senary
- Font Name: Inter 18pt
- Font color: #A8361A

## Links
<!-- A choice run (` | ` options of one md2ui.choice) is one segmented control. -->
Segmented: yes
Corner radius: 44
Padding top: 14
Padding bottom: 14
Padding left: 28
Padding right: 28
Emoji gap: 8
Emoji shape: circle
Emoji weight: 500
Emoji optical size: auto
Fill color: #2D4E3A
Disabled fill color: #E3EBD3
Disabled text color: #9AA59D
Disabled stroke color: #00000000

### Secondary
Fill color: #00000000
Stroke width: 1.5
Stroke color: #2D4E3A
Disabled fill color: #00000000
Disabled stroke color: #E3EBD3

### Tertiary
Padding top: 9
Padding bottom: 9
Padding left: 16
Padding right: 16
Emoji gap: 6

### Quaternary
Padding top: 9
Padding bottom: 9
Padding left: 16
Padding right: 16
Emoji gap: 6
Fill color: #00000000
Stroke width: 1.5
Stroke color: #2D4E3A
Disabled fill color: #00000000

### Quinary
Padding top: 7
Padding bottom: 7
Padding left: 12
Padding right: 12
Emoji gap: 4

<!-- The muted icon button: a cream disc, an ink glyph. Add, remove, like. -->
### Senary
Padding top: 8
Padding bottom: 8
Padding left: 8
Padding right: 8
Emoji gap: 4
Emoji weight: 600
Fill color: #F9F3EB
<!-- A shade off the cream, so the lime-page rule below does not turn a disabled
button forest: it stays pale everywhere. -->
Disabled fill color: #F7F1E8
Disabled text color: #C5CCC4

### Septenary
Padding top: 4
Padding bottom: 4
Padding left: 10
Padding right: 10
Emoji gap: 4
Fill color: #00000000
Stroke width: 1
Stroke color: #2D4E3A
Disabled fill color: #00000000

### Text
Fill color: #00000000
Padding: 0

### Inline
Text color: #2D4E3A
Underline: yes

## Inline Code
<!-- Chips are small pills. Bare: a cream tag (an ingredient, a size). The four
product labels are pinned below under Fixed colors, so their colour comes from
their words: New mustard, Offer orange, Limited edition and Chef's Pick forest. Each label leads with its emoji: `✨ New`, `🔥 Offer`, `⏳ Limited edition`, `👑 Chef's Pick`.
** a done status (forest tint), *** an open one (mustard tint), __ a stopped one
(orange tint). -->
Fill color: #F9F3EB
Stroke width: 1
Stroke color: #00000000
Disabled fill color: #00000000
Disabled stroke color: #E3EBD3
Disabled text color: #9AA59D
Corner radius: 12
Padding top: 4
Padding bottom: 4
Padding left: 10
Padding right: 10
Emoji weight: 600

### Secondary
Fill color: #FFFFFF
Stroke color: #2D4E3A

### Tertiary
Fill color: #DCE8DF

### Quaternary
Fill color: #FBEBD0

### Quinary
Corner radius: 8
Padding top: 2
Padding bottom: 2
Padding left: 6
Padding right: 6

### Senary
Fill color: #FFE3D8

## Emoji styles
Font: assets/icons/material-design-icons-md2ui.ttf

<!-- Every emoji draws as a Material Symbols icon. Bare: a cream disc with a forest
glyph, leading a row. * the large badge a page is about: an empty cart, an order's
status, a successful payment. ** a bare small glyph beside a caption: the star, the
delivery clock. *** an extra-small one. -->

### Primary
Shape: circle
Size: 18
Padding: 9
Emoji weight: 500
Emoji optical size: auto
Icon color: #2D4E3A
Background color: #F8F2EA

### Secondary
Shape: circle
Size: 40
Padding: 20
Emoji weight: 500
Emoji fill: 1
Icon color: #2D4E3A
Background color: #DCE8DF

### Tertiary
Size: 16
Padding: 0
Emoji weight: 600
Emoji fill: 1
Icon color: #7A887E
Background color: #00000000

### Quaternary
Shape: circle
Size: 11
Padding: 3
Emoji weight: 600
Icon color: #2D4E3A
Background color: #DCE8DF

### Text
Color: #7A887E

### Link
Color: #FFFFFF

### Inline
Color: #2D4E3A

## Fixed colors

### Pills
#### Exact
- ✨ New: Text color: #3A2603, Fill color: #E69F35
- 🔥 Offer: Text color: #FFFFFF, Fill color: #FF642D
- ⏳ Limited edition: Text color: #FFFFFF, Fill color: #2D4E3A
- 👑 Chef's Pick: Text color: #FFFFFF, Fill color: #2D4E3A
- Free: Text color: #1F5A35, Fill color: #DCE8DF
<!-- An order's final stages take their colour from their words, as `**`Delivered`**` and
`__`Cancelled`__` draw them: a running order's chip (`***`) is moved by a feed, which changes
its words and never its spelling, so it turns green or orange when it lands. -->
- Delivered: Text color: #1F5A35, Fill color: #DCE8DF
- Cancelled: Text color: #A8361A, Fill color: #FFE3D8
#### Contains
- % off: Text color: #FFFFFF, Fill color: #FF642D

### Buttons
<!-- Cancelling an order cannot be undone, so its button is a deep orange-red whatever its
variant: filled with a white label as the sheet's main action, outlined with a red label as
the quieter one on the order page. -->
#### Contains
- Cancel order: Text color: #A8361A, Fill color: #A8361A, Stroke color: #A8361A

### Emoji
<!-- A rating star is mustard, a liked heart orange. -->
- ⭐ #E69F35
- ❤️ #FF642D
- 🔥 #FF642D
<!-- The order's states, on the large status badge and on each update row. -->
- 🧾 #2D4E3A
- 👨‍🍳 #8A5410
- 🛵 #A8361A
- 🏁 #1F5A35
- ✅ #1C2B22
- ⚠️ #8A5410
- ✔️ #1C2B22
- ❌ #A8361A

### Emoji background
- ✅ #E69F35
- ✔️ #E69F35
- 🧾 #DCE8DF
- 👨‍🍳 #FBEBD0
- 🛵 #FFE3D8
- 🏁 #DCE8DF
- ❌ #FFE3D8
- ⚠️ #FBEBD0

## Separators
Dash: hide
Pipe: hide

## Horizontal Rule
Stroke width: 1
Stroke color: #E3EBD3

## Drawing elements

### Ratio Bars
Thickness: 10
Corner radius: 5
Text side: right
Background color: #E69F35

### Ratio Bar Track
Background color: #F8F2EA
Corner radius: 5

<!-- A progress line (On the way: 75%): a mustard bar on a cream track. -->
### Key Value Bars
Thickness: 10
Corner radius: 5
Background color: #E69F35
Position: below

### Key Value Bar Track
Background color: #F8F2EA
Corner radius: 5

### Task controls
Type: checkbox
Size: 20
Padding: 5
Corner radius: 10
Space: 12

### Checked outer
Background color: #FFFFFF
Stroke width: 2
Stroke color: #2D4E3A

### Checked inner
Background color: #2D4E3A

### Unchecked outer
Background color: #FFFFFF
Stroke width: 2
Stroke color: #7A887E

### Unchecked inner
Background color: #00000000

### Sliders
Style: line
Axis: horizontal
Length: 220
Thickness: 6
Circle diameter: 22

### Slider Track
Background color: #F8F2EA

### Slider Bar
Background color: #2D4E3A

### Slider Handle
Background color: #FFFFFF
Stroke width: 2
Stroke color: #2D4E3A

## Code Blocks
Syntax style: friendly
Background color: #F8F2EA
Corner radius: 12
Padding: 16
Line spacing: 4

## Charts
Bar thickness: 14
Bar spacing: 10
Bar width: fill
Corner radius: 7
Background color: #2D4E3A
Negative color: #FF642D

### Chart Track
Background color: #F8F2EA
Corner radius: 7

### Chart Series Colors
- #2D4E3A
- #E69F35
- #FF642D

### Chart Labels
- Font Name: Inter 18pt
- Font size: 12
- Font color: #4A5A50

### Chart Values
- Font Name: Inter 18pt
- Font size: 11
- Font color: #1C2B22

## Tables

### Table
Merge rows: no
Row spacing: 10
Col spacing: 4
Stacking cards: yes
Card layout: title

### Header
Background color: #00000000
Padding: 6
- Font name: Plus Jakarta Sans
- Font size: 12
- Font weight: 700
- Font color: #1C2B22

### Cells
Background color: #00000000
Padding: 6
- Font name: Inter 18pt
- Font size: 14
- Font color: #4A5A50

### Card Keys
Key spacing: 6
- Font name: Inter 18pt
- Font size: 11
- Font color: #7A887E

## Color Replacements

<!-- On the forest band and the forest offer card: white words; the forest button
turns mustard with an ink label, as the reference's Get Started does; an outlined
button turns white. -->
On background color: #2D4E3A
- Replacement: #FFFFFF
- Fill color: #2D4E3A, Replacement: #E69F35
- Stroke color: #2D4E3A, Replacement: #FFFFFF
- Text color: #2D4E3A, Replacement: #FFFFFF
- Fill color: #F9F3EB, Replacement: #FFFFFF26
- Fill color: #F8F2EA, Replacement: #FFFFFF26
- Fill color: #DCE8DF, Replacement: #FFFFFF26
- Text color: #4A5A50, Replacement: #FFFFFF

<!-- On the mustard card, and inside the forest button flipped mustard on the band: ink. -->
On background color: #E69F35
- Replacement: #3A2603
- Text color: #FFFFFF, Replacement: #3A2603
- Fill color: #2D4E3A, Replacement: #FFFFFF
- Stroke color: #2D4E3A, Replacement: #3A2603
- Fill color: #F9F3EB, Replacement: #FFFFFF59
- Fill color: #F8F2EA, Replacement: #FFFFFF59
- Text color: #4A5A50, Replacement: #3A2603

On background color: #FF642D
- Replacement: #FFFFFF
- Fill color: #2D4E3A, Replacement: #FFFFFF
- Stroke color: #2D4E3A, Replacement: #FFFFFF
- Text color: #2D4E3A, Replacement: #FFFFFF
- Fill color: #F9F3EB, Replacement: #FFFFFF33
- Fill color: #F8F2EA, Replacement: #FFFFFF33
- Text color: #4A5A50, Replacement: #FFFFFF

<!-- Straight on the lime page (not inside a card), where a light gray would vanish:
- the cream icon buttons (➕ ➖ 🤍) and the cream tags turn forest; their words and glyphs
  then turn white through the forest rules above;
- a disabled small button (#F7F1E8) and a disabled big one (#E3EBD3) take a green-gray
  disc that reads as off, with a darker glyph or label (the two groups below);
- the cream surfaces (#F8F2EA: the cart summary, bar tracks, icon badges, code) turn white,
  as the cards are;
- rules and disabled outlines (#E3EBD3) darken.
Inside a white card nothing changes. -->
On background color: #F2FCD9
- Fill color: #F9F3EB, Replacement: #2D4E3A
- Fill color: #F7F1E8, Replacement: #DCE6CC
- Fill color: #E3EBD3, Replacement: #D3DFC0
- Fill color: #F8F2EA, Replacement: #FFFFFF
- Stroke color: #E3EBD3, Replacement: #B9C9A6

<!-- The disabled glyph and label on those discs, dark enough to read. -->
On background color: #DCE6CC
- Text color: #C5CCC4, Replacement: #7F8C81

On background color: #D3DFC0
- Text color: #9AA59D, Replacement: #66756A

<!-- The destructive button's label on its own red fill. -->
On background color: #A8361A
- Replacement: #FFFFFF

<!-- A cream tag turned translucent on a coloured card: its words follow the card. -->
On background color: #FFFFFF26
- Replacement: #FFFFFF

On background color: #FFFFFF33
- Replacement: #FFFFFF

On background color: #FFFFFF59
- Replacement: #3A2603

<!-- A label inside a button flipped white keeps the brand ink. -->
On background color: #FFFFFF
- Text color: #FFFFFF, Replacement: #2D4E3A

On background color: image
- Replacement: #FFFFFF
