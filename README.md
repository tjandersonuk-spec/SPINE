# spine-app

A starter application built with **Vite**, **React**, **TypeScript**, **Tailwind CSS v4**, and **shadcn/ui**.

## Stack

| Tool | Version | Notes |
| --- | --- | --- |
| Vite | 8 | Dev server and build tooling |
| React | 19 | With `@vitejs/plugin-react` |
| TypeScript | 6 | Project references (`tsconfig.app.json` / `tsconfig.node.json`) |
| Tailwind CSS | 4 | Via `@tailwindcss/vite` — no `tailwind.config.js`, theme lives in CSS |
| shadcn/ui | new-york | Components vendored into `src/components/ui` |
| oxlint | 1 | `npm run lint` |

## Getting started

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build     # tsc -b && vite build
npm run preview   # preview the production build
npm run lint      # oxlint
```

## Project layout

```
src/
  components/ui/   shadcn/ui components (button, card, input, label)
  lib/utils.ts     the `cn()` class-merging helper
  index.css        Tailwind import + shadcn design tokens (light & dark)
  App.tsx          demo page
components.json    shadcn/ui configuration
```

The `@/*` import alias maps to `src/*`, configured in both `vite.config.ts` and the
TypeScript configs.

## Adding shadcn/ui components

```bash
npx shadcn@latest add dialog
```

The components already present were added by hand rather than by the CLI, because
`ui.shadcn.com` was unreachable from the environment they were created in. They match
the standard new-york / neutral output, so the CLI will work normally from here.

## Theming

Design tokens are defined as CSS custom properties in `src/index.css` — `:root` for
light and `.dark` for dark — and exposed to Tailwind through `@theme inline`. Dark mode
is opt-in via the `dark` class on `<html>`; the demo page includes a toggle.
