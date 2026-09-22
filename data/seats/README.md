# Seat layout registry

SunSeat uses the official KORAIL public seat-plan HTML as the structural source.
The sync script stores the raw HTML under
`data/raw/korail-seat-layouts/` and writes the verified registry to
`data/processed/seat-layouts.json`.

The registry contains actual seat identifiers and excludes official `noseat`
positions. The source seat-line grouping is retained as `layoutRow` so the
frontend can render window-side seats, aisle, and the opposite window-side
seats in the same row. It is structural only: SunSeat does not query or
display live remaining-seat availability. If a rolling-stock type has several
verified variants, the API returns every verified layout in `variantLayouts`
and the UI lets the user choose one. Types without a verified official source
remain unavailable instead of receiving fabricated seat numbers.
