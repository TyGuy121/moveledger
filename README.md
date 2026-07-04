# The Move Ledger

A single-page calculator for modeling a **sell-in-Texas, buy-in-California** home move. Enter what you'd net from selling your current home, the price of the home you're buying, and your financing terms — and see the estimated all-in monthly payment, an affordability check, and a side-by-side comparison of saved scenarios.

Built as a static site: plain HTML, CSS, and vanilla JavaScript. No build step, no backend, no tracking. All scenarios and preferences are stored locally in your browser.

## Features

- **Sell side (Texas net sheet).** Models a seller's net proceeds including agent commissions, the owner's title policy (Texas TDI basic premium rates effective March 1, 2026), escrow/recording/attorney fees, and property-tax proration to the closing date. A simpler "flat closing %" mode is also available.
- **Buy side.** Purchase price, down payment (with a one-click "use all proceeds"), and the resulting loan amount and leftover cash.
- **Financing & carry.** Rate, term, property-tax rate, insurance, and HOA roll up into an estimated monthly payment (principal & interest, taxes, insurance, HOA) with a visual breakdown.
- **Affordability check.** Optional income input flags the payment against the common 28% / 36% guidelines.
- **Scenario comparison.** Save any scenario and compare them side by side; the lowest monthly payment is flagged.
- **Light & dark themes**, remembered across visits.

## Running locally

It's just static files, so any of these work:

```bash
# Open directly
open index.html

# Or serve it
python3 -m http.server 4173
# then visit http://localhost:4173
```

## Notes

All figures are estimates. Lender quotes, actual parcel tax bills, and insurance premiums will vary — confirm specifics with your lender, title company, and county assessor. The default input values are illustrative placeholders, not real figures.
