<!--Source https://p.superdesign.dev/draft/1a57fa51-6aa7-451f-96bf-94dc03a0909e-->
<!-- Fonts: Archivo, Jetbrains Mono-->
<!-- Also reproduced, content only (no nav, ticker or footer): the PROMPTSMITH wall of proof,
p.superdesign.dev_draft_15960e0e-35db-4ad0-89da-1e04a3da10c4.png, and the CAROUSEL/DESIGN hero,
4a7a8485-8263-4a8a-8f79-faf31f8f8831.png. One THEME.md, HARDSTOP's look. -->

# 

___
`▣ Component / Button`

___Buttons\
with a `spine.`___

A full button system rendered in raw `brutalist` craft. Thick black borders, a hard offset shadow that `compresses on press`, no soft gradients, no apologies. Every variant, size and state on one canvas.

[✨ Generate a button](agent:generate-button) *[View prompt](agent:view-prompt)*
::: 1 >
> _Live_preview.tsx_
>
> [Primary](agent:preview?variant=primary)
>
> *[Secondary](agent:preview?variant=secondary)*
>
> **[Inverse](agent:preview?variant=inverse)**
>
> _[Pressed](agent:preview?variant=pressed)_ - _← compresses_
:::1
___
***
___

# 

## *`01 / Anatomy`* - The shadow is the whole point. {#section-title-1}

### 
[Rest state](agent:state?s=rest)
_Offset 5px / 5px_
_Border 3px solid_

### 
[Hover state](agent:state?s=hover)
_Lifts −1px_
_Shadow grows to 6px_

### 
[Active state](agent:state?s=active)
_Drops +5px into shadow_
_Shadow → 0 (compressed)_
***
***
___

# {#beige-band-1}

## *`02 / Variants`* - Five flavors, one backbone. {#section-title-2}

### 
[Primary](agent:variant?v=primary)
_Acid_

### 
*[Secondary](agent:variant?v=secondary)*
_Paper_

### 
**[Inverse](agent:variant?v=inverse)**
_Ink_

### 
***[Ghost](agent:variant?v=ghost)***
_Ghost_

### 
___[No-shadow](agent:variant?v=flat)___
_Flat_
***
***
___

# 

## *`03 / Sizes`* - Small → Medium → Large. {#section-title-3}

### 

_[Small](agent:size?s=sm)_
_SM · 12px · 2px border_

[Medium](agent:size?s=md)
_MD · 15px · 3px border_

__[Large](agent:size?s=lg)__
_LG · 19px · 4px border_
***
***
___

# {#beige-band-2}

## *`04 / With icon`* - Labels, icons & squares. {#section-title-4}

### 
[📤 Send](agent:icon?i=send)
_Leading icon_

### 
**[Download ⬇️](agent:icon?i=download)**
_Trailing icon_

### 
*[…](agent:icon?i=more)*
_Icon only_

### 
[❤️](agent:icon?i=like)
_Icon · acid_
***
***
___

# 

## *`05 / States`* - Every state, on the record. {#section-title-5}

### 
[Default](agent:state?s=default)
_Default_

### 
[Hover](agent:state?s=hover)
_Hover_

### 
[Pressed](agent:state?s=pressed)
_Active_

### 
~~[Disabled](agent:state?s=disabled)~~
_Disabled_

### 
**[🔄 Loading](agent:state?s=loading)**
_Loading_

### 
[✅ Success](agent:state?s=success)
_Success_

### 
**[🔒 Focused](agent:state?s=focused)**
_Focus-ring_

### 
[⚠️ Destructive](agent:state?s=destructive)
_Danger_
***
***
___

# {#ink-band-1}

## *`06 / Matrix`* - Variant × size, full sweep. {#section-title-6}

| Variant ↓ / Size → | Small | Medium | Large |
|---|:---:|:---:|:---:|
| Primary | _[Action](agent:matrix?v=primary&s=sm)_ | [Action](agent:matrix?v=primary&s=md) | __[Action](agent:matrix?v=primary&s=lg)__ |
| Secondary | *[Action](agent:matrix?v=secondary&s=sm)* | *[Action](agent:matrix?v=secondary&s=md)* | *[Action](agent:matrix?v=secondary&s=lg)* |
| Inverse | **[Action](agent:matrix?v=inverse&s=sm)** | **[Action](agent:matrix?v=inverse&s=md)** | **[Action](agent:matrix?v=inverse&s=lg)** |
| Icon | _[➡️](agent:matrix?v=icon&s=sm)_ | [➡️](agent:matrix?v=icon&s=md) | __[➡️](agent:matrix?v=icon&s=lg)__ |
***
***
___

# {#acid-band-1}

___
___Ship this\
button system.___

Drop the prompt into Superdesign and it generates the whole brutalist set\: borders, offset shadows, press-to-compress, every variant and state.
::: 1 >
```
// PROMPT
Design a brutalist button system: 3px black
borders, hard 5px offset shadow that compresses
to 0 on active. Variants: primary (acid-yellow),
secondary, inverse, ghost, no-shadow. Sizes
sm/md/lg. States: default, hover, pressed,
disabled, loading.
```

[📋 Copy prompt](agent:copy-prompt)
:::1
___
***
___

# 

___
`The wall of proof`

___People\
who stopped\
staring at\
`blank canvas.`___
::: 1 >
- ___4.9___ : _Avg rating_
- ___2.1k___ : _Reviews & counting_
:::1
___

[All proof](agent:filter?f=all) *[From devs](agent:filter?f=devs)* *[From founders](agent:filter?f=founders)* *[From designers](agent:filter?f=designers)* *[People who switched](agent:filter?f=switched)*

### {#acid-2}
__"Shipped a full `dashboard` UI before my coffee went cold. This thing just gets what I'm typing."__
The prompt library is doing all the heavy lifting. I went from staring at an empty frame to three real mockups in one prompt.
---
**`MR`** - **Mara Reyes** : _Solo founder_

### {#paper-2}
... `Via X`
__"I run it straight from Claude Code. The canvas keeps up with me. Never going back to blank Figma files."__
---
**`DK`** - **Dev Krause** : _Staff engineer_

### {#ink-1}
__"Our whole product team uses it now. Mockups in standup, components by lunch. Genuinely changed our velocity."__
---
**`TO`** - **Tomas Oren** : _Head of product_

### {#paper-3}
__"No design degree, no excuses. I describe the screen, it draws the screen. That's the whole pitch and it delivers."__
---
**`NV`** - **Nadia Volk** : _Indie hacker_

### {#acid-3}
__"It feels like pair-designing with someone who never gets tired."__
---
**`JP`** - **Jun Park** : _Design lead_

### {#paper-4}
__"Switched from three different tools to just this. The infinite canvas plus prompts combo is unfairly good."__
---
**`ES`** - **Elif Soto** : _Product designer_
***

## Got a win to share? {#ink-2}
_Drop a review. We read every single one._
:::
... [Leave a testimonial](agent:leave-testimonial)
___
***
***
___

# 

___
`■ Prompt library / Carousel pack` - _V2.0 / 38 layouts_

___Carousels\
that `don't`\
`blink`___

__A raw, confident slider system for AI product design. Hard borders, blocky indices, zero fade. Prompt it once, ship it everywhere.__

**[See it move ⬇️](agent:see-it-move)** *[Copy the prompt](agent:copy-prompt?pack=carousel)*

_☑️ No-JS keyboard nav_ +++ _☑️ Tailwind native_ +++ _☑️ Drop-in tokens_
::: 1 >
- ___38___ : _Slider layouts_
- ___0ms___ : _Fade delay_
- ___A11y___ : _Focus-safe_
- ___5k+___ : _Remixes_
:::1
___
***
