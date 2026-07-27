# Effect MCP IDE — active instructions

This application has been adapted from Visual Effect into the Effect MCP IDE. The upstream documentation below remains useful for its visualization primitives, but its example-gallery product description is historical rather than the active product contract.

## Product boundary

- The north star is editable, low-code MCP application authoring in Effect.
- Editable graph authoring and fixture-backed trace replay are implemented; do not present the current application as live SDK execution or as a complete first pass.
- Authoring and execution share `src/mcp-ide/model/McpGraphDocument.ts`. Do not create a second topology representation in React state.
- UI gestures and future agent actions must use the immutable commands in `src/mcp-ide/authoring/GraphCommands.ts` so validation and history stay consistent.
- Trace, fixture, future live SDK, and MCP Apps adapters emit the same normalized trace event contract.
- Keep React, Next.js, Motion, Tone, and browser dependencies isolated in this application. They must not enter the root SDK's production dependencies.
- Stable and preview MCP Apps profiles remain explicit. Do not infer a profile from the shared extension identifier.

## Development workflow

In this application, use Bun for package management and scripts.

```bash
bun install --frozen-lockfile
bun run test --run src/mcp-ide
bun run typecheck
bun run build
```

Use test-first development for graph, trace, replay, authoring-command, compiler, and adapter behavior. Preserve the `FIXTURE REPLAY` disclosure until a real live adapter is selected and running.

## Active architecture

- `src/mcp-ide/model/` — serializable authoring and trace contracts
- `src/mcp-ide/authoring/` — validated graph commands, history, and document import/export
- `src/mcp-ide/trace/` — Effect-backed replay lifecycle
- `src/mcp-ide/scenarios/` — deterministic fixtures
- `src/mcp-ide/components/` — visual projections only
- `src/VisualEffect.ts` and related components — upstream state/motion primitives available for selective adaptation

## Upstream Visual Effect reference

## Overview

Visual Effect is an interactive visualization tool for the Effect library that demonstrates how Effect operations execute over time. Built with Next.js 15 and React 19, it provides animated visual representations of Effect constructors and combinators with synchronized sound effects, making it easier to understand their behavior.

**In this house, we use bun.** All package management and script execution should use `bun` commands, not `npm` or `node`.

## Core Concepts

### 1. VisualEffect

The `VisualEffect` class is the heart of the visualization system. It wraps Effect operations and tracks their execution state for visualization purposes.

```typescript
// Creating a visual effect
const myEffect = visualEffect("taskName", Effect.succeed(42));
```

Key features:
- **State tracking**: idle → running → completed/failed/interrupted/death
- **Observable hooks**: React components subscribe via `useVisualEffectState`, `useVisualEffectNotification`, or `useVisualEffectSubscription`
- **Effect caching**: Prevents re-execution of already completed effects
- **Timer support**: Captures start/end timestamps when `showTimer` is enabled
- **Notification helpers**: Effects can publish contextual messages through `notify(...)`
- **Sound triggers**: Automatically plays sounds on state transitions

### 2. EffectNode Component

The `EffectNode` component renders individual effects as animated circles with:
- Different colors for different states (idle, running, completed, failed)
- Pulsing animations during execution
- Result display using the renderer system
- Automatic width expansion when results overflow the default size
- Overlay feedback for errors and notifications

### 3. Renderer System

Results are displayed using a flexible renderer pattern:

```typescript
class MyResult implements RenderableResult {
  constructor(public value: any) {}
  
  render() {
    return <div>{this.value}</div>;
  }
}
```

Built-in renderers:
- `NumberResult` - Simple number display
- `StringResult` - Simple string display
- `BooleanResult` - True/false text badge
- `TemperatureResult` - Temperature with a trailing ° symbol
- `ObjectResult` - JSON stringified objects
- `ArrayResult` - Animated array summary (length indicator)
- `EmojiResult` - Emoji-based results with enhanced visual appeal

### 4. Effect Examples

Each example follows a consistent pattern:

```typescript
export function EffectExampleName() {
  // 1. Create individual effects with memoization
  const effect1 = useMemo(() => visualEffect("name", effect), []);
  
  // 2. Create composed effect if needed
  const resultEffect = useMemo(() => {
    const composed = Effect.all([effect1.effect, effect2.effect]);
    return new VisualEffect("result", composed, [effect1, effect2]);
  }, [effect1, effect2]);
  
  // 3. Define code snippet and highlight mappings
  const codeSnippet = `...`;
  const effectHighlightMap = { ... };
  
  // 4. Return EffectExample component
  return <EffectExample ... />;
}
```

## Key Patterns

### 1. Jittered Delays

All examples use realistic, non-deterministic delays to simulate real-world conditions:

```typescript
export function getWeather(location?: string) {
  return Effect.gen(function* () {
    const delay = getDelay(500, 900); // Random 500-900ms
    yield* Effect.sleep(delay);
    return new TemperatureResult(...);
  });
}
```

### 2. Responsive Design

- Layout built with Tailwind utility classes and Motion; flex containers wrap naturally on small screens
- Sidebar navigation collapses on narrow viewports while the main content remains accessible
- Typography and spacing scale using relative units for readability across devices

### 3. State Management

- Each `VisualEffect` manages its own state
- React components subscribe via `useVisualEffectState`, `useVisualEffectNotification`, or `useVisualEffectSubscription`
- Lightweight hooks (`useOptionKey`, `useStateTransition`, `useVisualScope`) handle UI-specific state
- No global state management for effect execution
- Effects persist across component re-renders

### 4. Animation System

- Uses Motion (Framer Motion successor) for smooth transitions
- Spring animations for natural movement with configurable physics
- Different animations for different state transitions
- Hardware-accelerated transforms
- Dedicated sequences for running jitter, failure shakes, and death glitches

### 5. Sound System

The application includes a synthesized sound system using Tone.js:

- **Distinct cues**: Success, running, failure, interruption, reset, death, ref updates, finalizers, and notifications all receive unique tones
- **Shared processing**: A centralized `taskSounds` module initializes synths, routing, and reverb once and gates playback behind a mute flag
- **User controls**: The header exposes an ON/OFF toggle that updates the mute state and plays a confirmation chime when sound is enabled
- **Integration**: `VisualEffect.setState()` and companion helpers trigger the appropriate cues during state transitions

## File Structure

```
app/                         # Next.js App Router
├── layout.tsx              # Root layout with metadata
├── page.tsx                # Home page
├── [exampleId]/
│   └── page.tsx            # Individual example pages
└── ClientAppContent.tsx    # Client-side app content

src/
├── animations.ts           # Shared animation tokens
├── AppContent.tsx          # Main app component
├── components/
│   ├── CodeBlock.tsx       # Syntax-highlighted code
│   ├── HeaderView.tsx      # Example headers + controls
│   ├── ScheduleTimeline.tsx # Scheduling visualizer
│   ├── Timer.tsx           # Elapsed time labels
│   ├── display/            # Display components
│   │   ├── EffectExample.tsx # Main example wrapper
│   │   └── RefDisplay.tsx  # Ref visualizations
│   ├── effect/             # Effect visualization primitives
│   │   ├── EffectNode.tsx
│   │   ├── EffectOverlay.tsx
│   │   ├── taskUtils.ts
│   │   └── useEffectMotion.ts
│   ├── feedback/           # User feedback
│   │   ├── DeathBubble.tsx
│   │   ├── FailureBubble.tsx
│   │   └── NotificationBubble.tsx
│   ├── layout/             # Layout components
│   │   ├── NavigationSidebar.tsx
│   │   └── PageHeader.tsx
│   ├── renderers/          # Result rendering system
│   │   ├── ArrayResult.tsx
│   │   ├── BasicRenderers.tsx
│   │   ├── EmojiResult.tsx
│   │   └── TemperatureResult.tsx
│   ├── scope/
│   │   ├── FinalizerCard.tsx
│   │   └── ScopeStack.tsx
│   └── ui/
│       ├── QuickOpen.tsx
│       ├── SegmentedControl.tsx
│       └── VolumeToggle.tsx
├── constants/
│   ├── colors.ts
│   └── dimensions.ts
├── examples/               # Effect examples
│   ├── helpers.ts          # Shared utilities
│   ├── effect-*.tsx        # Effect examples
│   └── ref-*.tsx          # Ref examples
├── hooks/                  # Custom hooks
│   ├── useOptionKey.ts     # Option key detection
│   ├── useStateTransition.ts # Effect transition tracking
│   └── useVisualScope.ts   # Scope management
├── lib/                    # Library code
│   ├── example-types.ts    # Type definitions
│   └── examples-manifest.ts # Example registry
├── shared/                 # Shared utilities
│   ├── appItems.ts
│   └── idUtils.ts
├── sounds/
│   └── TaskSounds.ts       # Synthesized sound system
├── theme.ts                # Theme tokens
├── VisualEffect.ts         # Core effect visualization
├── VisualRef.ts           # Ref visualization
├── VisualScope.ts         # Scope visualization
└── VisualEffect.test.ts    # Unit tests
```

## Design Decisions

### 1. No External State Management
Each task manages its own state internally, avoiding complexity and making examples self-contained.

### 2. Effect-First Design
The visualization follows Effect's execution model closely - tasks only run when their effect is executed.

### 3. Realistic Timing
All examples use jittered delays to demonstrate non-deterministic behavior, especially important for race conditions.

### 4. Mobile-Responsive
The entire UI adapts to mobile screens without compromising the desktop experience.

### 5. Type Safety
Strict TypeScript configuration catches errors at compile time, including:
- `isolatedModules` for Next.js compatibility
- `noUncheckedIndexedAccess` for array safety
- `exactOptionalPropertyTypes` for precise optional handling
- Effect-specific TypeScript plugin for enhanced type checking

### 6. Audio Experience
Sounds are designed to enhance understanding without being intrusive:
- Short, focused cues map directly to running, completion, failure, interruption, and reset events
- A centralized sound module keeps the palette cohesive and manages initialization/muting
- Automatic sound on state transitions with respectful default levels
- User-friendly mute control without in-app volume sliders (defers to system volume)

## Common Operations

### Adding a New Effect Example

1. Create a new file in `src/examples/`
2. Use the `getWeather` helper for consistent behavior
3. Follow the example pattern (memoized effects, code snippet, highlight map)
4. Add to the examples manifest in `src/lib/examples-manifest.ts`
5. Generate OG images with `bun run generate-og-images`

### Creating Custom Renderers

1. Implement the `RenderableResult` interface in `src/components/renderers/`
2. Add a `render()` method returning JSX
3. Export from the renderers index file
4. Use in your effect: `Effect.map(value => new MyRenderer(value))`

### Modifying Animations

Look in `EffectNode.tsx` and `animations.ts` for animation configurations:
- Spring settings including `defaultSpring` for MotionConfig
- Color transitions in state change logic
- Timing constants in individual components
- All animation tokens centralized in `animations.ts`

## Best Practices

1. **Always memoize effects** - Prevents recreation on every render
2. **Use built-in helpers** - `getWeather()` for consistency
3. **Keep effects pure** - Side effects only for visualization
4. **Test on mobile** - Ensure responsive behavior works
5. **Follow the pattern** - Consistency makes the codebase maintainable
6. **Use proper accessibility** - Provide ARIA labels, focus states, and keyboard-friendly controls
7. **Optimize bundle size** - Lazy load examples and use code splitting

## Copy Style Guide

### Text and Descriptions

**Example Descriptions:**
- Use imperative mood (e.g., "Create", "Run", "Compose")
- No ending punctuation (periods, exclamation marks)
- Start with action verbs for consistency
- Keep descriptions concise but informative

**Good Examples:**
- "Run multiple effects concurrently and compose their results"
- "Interrupt a running effect after a specified duration"
- "Accumulate validation errors instead of failing fast"

**Avoid:**
- Present tense ("Creates", "Runs", "Composes")
- Ending punctuation ("Create a new task.")
- Passive voice ("A task is created")

**UI Text:**
- Use proper articles (a, an, the) in prose
- Maintain consistent tone throughout the application
- Keep instructions clear and action-oriented
- Use sentence case for buttons and labels

**Error Messages:**
- Start with the action or context
- Be specific about what went wrong
- Provide actionable next steps when possible

**Code Comments:**
- Use present tense for describing what code does
- Keep comments concise and focused on the "why"
- Avoid obvious comments that just restate the code

## Architecture Decisions

### 1. Next.js App Router
Migrated from Vite to Next.js 15 for:
- Better SEO with server-side rendering
- Individual pages for each example
- Automatic code splitting and optimization
- Built-in image optimization

### 2. Component Architecture
Organized components by domain:
- `display/` - Main display logic
- `effect/` - Effect visualization specifics
- `feedback/` - User feedback components
- `layout/` - Layout and navigation
- `renderers/` - Result rendering system
- `scope/` - Scope and finalizer visualization
- `ui/` - Reusable UI components
- Top-level helpers (`CodeBlock`, `HeaderView`, `Timer`, `ScheduleTimeline`) live alongside these folders

### 3. New Visualization Types
Expanded beyond basic effects to include:
- **Ref visualization** with `VisualRef` class
- **Scope visualization** with finalizer tracking
- **Quick-open modal** and link-copy affordances for faster exploration
- **Lazy loading** for better performance

### 4. Enhanced Developer Experience
- Biome for linting and formatting (replaced ESLint/Prettier)
- TypeScript strict mode with Effect language service
- Automated OG image generation for social sharing
- Comprehensive example manifest system
