# UI Rebuild 2026

## Goal

Premier's UI is rebuilt around a stable application shell and declarative navigation so visual changes do not silently change behavior.

## Rules

1. `src/core/navigation/routes.ts` is the single source of truth for application routes.
2. `src/core/navigation/menu.config.ts` is the single source of truth for sidebar navigation.
3. Navigation identity is stable (`id`), independent of position in the DOM.
4. Permissions belong to menu configuration and route guards; they are never inferred from visual placement.
5. Shared `Button` defaults to `type="button"` to prevent accidental form submission when a button is moved into a form.
6. `Layout` is the only application shell for protected non-fullscreen pages.
7. POS remains fullscreen by design and owns its own workspace layout.
8. Dashboard-specific composition must never create another global shell.
9. Legacy routes may redirect to canonical routes, but new UI links must use `APP_ROUTES`.
10. Every new menu item must have a route, stable id, and permission policy where applicable.

## Extension pattern

To add a new screen:

1. Add the canonical route to `APP_ROUTES`.
2. Add the page route in `src/app/routes.tsx`.
3. Add one `MENU_ITEMS` entry if the screen belongs in navigation.
4. Add the required permission to the permission model.
5. Add a route/navigation regression test when behavior is non-trivial.
6. Add E2E coverage for the user-visible action before enabling deployment.

Moving a menu item between groups or changing its visual component must not require changing the route, permission, or data service.

## Data boundary

UI components should call feature services/hooks. They should not encode business rules based on DOM order, label text, or sibling position. Branch-sensitive data must continue to use the existing branch filter/RLS boundary.

## Migration strategy

This rebuild is intentionally performed on `ui-rebuild-foodics-2026` rather than directly on `main`. The existing feature pages and database behavior are preserved while the shell/navigation contract is stabilized first. Pages are migrated incrementally after the shell passes verification.
