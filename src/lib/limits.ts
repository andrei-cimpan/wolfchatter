// One source for limits that the database, the API schemas, and the UI all enforce.
// Author and body lengths must match the check constraints in db/migrations/0001_init.sql.

export const AUTHOR_MAX = 32;
export const BODY_MAX = 1000;

export const MESSAGE_LIMIT_DEFAULT = 50;
export const MESSAGE_LIMIT_MAX = 100;

// Upper bound accepted by the API, matching Leaflet's practical maximum. The standard
// OpenStreetMap tile server stops at 19, so the map's own maxZoom will be lower.
export const MAX_ZOOM = 22;
