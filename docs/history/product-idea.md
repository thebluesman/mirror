---

# Personal Home Digital Twin — Product Specification

## Product Vision

Build a local-first desktop/web application that allows a user to create a digital replica of their home, experiment with interior layouts, visualize furniture/decor changes, and translate digital decisions into accurate physical placement.

The product is not intended to be a public interior design platform or furniture marketplace.

It is a personal spatial design tool.

The core question it answers:

> "Before I move, buy, hang, or modify something in my home, what will it look like and exactly where should it go?"

---

# Core Principles

## 1. Accuracy over realism

The goal is not photorealistic rendering.

The priority order is:

1. Correct room dimensions
2. Correct furniture proportions
3. Correct placement
4. Useful visualization
5. Realistic materials/rendering

A simple accurate model is more valuable than a beautiful inaccurate render.

---

## 2. Local-first

The application should run locally.

Requirements:

* Local database
* Local project files
* No required cloud backend
* User owns all data

AI integrations can be external API calls, but the application itself should function independently.

---

## 3. AI as a design interface

AI should not replace the scene engine.

The architecture should separate:

```
User Intent

↓

AI Interpretation

↓

Structured Scene Commands

↓

Validation

↓

3D Scene Update
```

The AI layer interprets human requests.

The rendering engine executes deterministic changes.

---

# Primary User Journey

---

# 1. Create Home

The user creates a digital representation of their home.

Initial input sources:

### Primary:

Import existing floor plans.

Example:

* Figma export
* SVG
* JSON

The current workflow assumes a Figma-created floor plan:

* Scale: 1px = 1cm
* 95% accurate
* Contains walls, rooms, furniture placeholders, doors, windows

The importer should convert:

```
Figma Layers

↓

Semantic Objects

↓

3D Scene
```

Example:

Figma:

```
Living Room
 ├── North Wall
 ├── Balcony Window
 ├── Sofa
 └── TV Unit
```

becomes:

```
Scene

Room
 ├── Walls
 ├── Openings
 └── Furniture
```

---

# 2. Room Construction

The system should represent:

## Architecture

* Rooms
* Walls
* Doors
* Windows
* Floor
* Ceiling height

Each element has:

```
Position
Rotation
Dimensions
Material
```

Example:

Wall:

```
Length: 520cm
Height: 300cm
Thickness: 15cm
```

---

# 3. Furniture System

Furniture should be parametric rather than dependent on 3D models.

The system should support:

* Sofa
* Chairs
* Tables
* Beds
* Cabinets
* Shelves
* Rugs
* Lamps
* Artwork
* Plants

Each object contains:

```
Object

Name
Category
Dimensions
Position
Rotation
Material
Colour
Image reference
Metadata
```

Example:

```
Sofa

Width:
220cm

Depth:
90cm

Height:
80cm

Material:
linen

Colour:
olive green

Style:
mid-century
```

---

# Furniture Input Workflow

Furniture sources:

* IKEA
* JYSK
* West Elm
* Pottery Barn
* Custom objects

User provides:

* Product URL
* Product image
* Dimensions

AI extracts:

* Name
* Dimensions
* Materials
* Style
* Colour

The application generates a lightweight 3D representation.

Do not depend on external furniture APIs.

---

# 4. Scene Editing

Users should be able to:

* Move objects
* Rotate objects
* Duplicate objects
* Delete objects
* Change materials
* Change colours

The primary editing mode should be:

## 2D floor plan

for arranging.

## 3D walkthrough

for evaluating.

Avoid making users manipulate everything in 3D.

---

# 5. AI Chat Interface

The application should include a conversational interface.

Examples:

## Moving objects

User:

"Move the sofa 50cm closer to the window."

AI:

Creates:

```
MOVE_OBJECT

object:
sofa

translation:
x +50cm
```

---

## Design exploration

User:

"What would this room look like with a darker rug?"

AI:

Creates:

```
CHANGE_MATERIAL

object:
rug

property:
colour

value:
dark charcoal
```

---

## Constraint-aware suggestions

User:

"Can I fit a larger dining table?"

System evaluates:

* Available space
* Walkways
* Door clearance

Response:

```
Current table:
160cm

Maximum recommended:
220cm

Minimum clearance:
90cm
```

---

# Scene Command Architecture

Do not allow LLMs to directly modify the scene.

Use an intermediate command layer.

Example:

```
LLM

↓

Scene Command

↓

Validation Engine

↓

Scene Database

↓

Renderer
```

Commands:

```
MOVE_OBJECT

ROTATE_OBJECT

CHANGE_MATERIAL

ADD_OBJECT

REMOVE_OBJECT

CREATE_CAMERA_POSITION
```

Every action should be reversible.

Maintain history:

```
Before State

↓

Command

↓

After State
```

---

# 6. Camera System

The application should support saved meaningful viewpoints.

Not just free camera movement.

Examples:

## Couch View

Camera:

```
Position:
Living room sofa

Target:
TV wall
```

## Entry View

Camera:

```
Position:
Front door

Target:
Living room
```

## Dining View

Camera:

```
Position:
Dining chair

Target:
Kitchen
```

Users should be able to say:

"Show me the room from the couch."

---

# 7. Rendering

Rendering priority:

## Real-time viewport

Use:

* Three.js
* WebGL

Features:

* Shadows
* Basic lighting
* Materials
* Camera controls

Avoid:

* Ray tracing
* Complex physics
* Unreal-level realism

---

# AI Rendering Enhancement (Future)

Optional workflow:

Current scene screenshot:

↓

AI image enhancement

↓

Architectural visualization

Important:

AI should preserve geometry.

It should improve:

* lighting
* textures
* realism

Not redesign the room.

---

# 8. Measurement System

One of the core features.

The application should translate digital placement into physical instructions.

Examples:

Artwork:

```
Wall:
Living Room North Wall

Artwork:
120cm wide

Placement:

Left edge:
245cm from corner

Bottom:
145cm from floor

Center:
205cm from floor
```

Furniture:

```
Sofa position:

Distance from window:
80cm

Distance from wall:
20cm
```

---

# 9. Photo/Vision Features

Photos should enhance the digital twin.

They should NOT be used initially for automatic room reconstruction.

Useful features:

---

## Material extraction

Input:

Photo of sofa

Output:

```
Material:
Boucle fabric

Colour:
Warm white

Texture:
High pile
```

---

## Artwork capture

Input:

Photo of artwork

Output:

Flat image asset.

---

## Room verification

Input:

Photo of room

Output:

Comparison against model.

Example:

```
Window position matches.

Sofa appears approximately 15cm deeper than model.
```

---

# Technical Architecture

Recommended:

## Frontend

React + Three.js

Responsibilities:

* UI
* Scene rendering
* Interaction

---

## Backend/local runtime

Node.js

Responsibilities:

* File management
* AI orchestration
* Database access

---

## Database

SQLite

Schema:

```
Homes

Rooms

Walls

Objects

Materials

CameraPositions

Measurements

History
```

---

# MVP Scope

The first usable version should include:

## Must have

✅ Import simple floor plan
✅ Create rooms
✅ Add furniture objects
✅ Move/rotate objects
✅ 2D floor plan view
✅ 3D view
✅ Save scenes
✅ Camera positions
✅ Measurement tool

---

## AI features

Include early:

✅ Chat → scene commands

Delay:

* Vision
* Image generation
* Automatic reconstruction

---

# Explicitly avoid

Do not build:

❌ Furniture marketplace
❌ AR mode
❌ VR mode
❌ Photorealistic renderer
❌ Automatic room scanning
❌ Physics simulation
❌ Full CAD system
❌ Public sharing platform

---

# Definition of Success

The application succeeds if the user can:

1. Import their actual home layout
2. Add their real furniture
3. Ask:

   > "What if I move this here?"
4. See the result immediately
5. Decide confidently
6. Measure exactly where to place things in real life

---

# Suggested First Development Milestone

Build a single-room prototype:

Input:

* One Figma-exported room
* Sofa
* Coffee table
* TV unit
* Rug
* Artwork

Capabilities:

* 2D arrangement
* 3D visualization
* Chat movement commands
* Saved camera angle
* Measurement overlay

If this works, expand to the entire home.

---

## Agent instruction

Do not attempt to build a full interior design platform.

Build a personal spatial reasoning tool.

Prioritize:

* correctness
* editability
* structured data
* AI-assisted interaction

over:

* visual polish
* realism
* asset quantity

---