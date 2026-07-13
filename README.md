# The Move Ledger

A single-page calculator for modeling a **sell-one-home, buy-another** move anywhere in the US. Enter what you'd net from selling your current home, the price of the home you're buying, and your financing terms — and see the estimated all-in monthly payment, an affordability check, and a side-by-side comparison of saved scenarios. Pick your destination state and the property-tax rate is filled in from that state's average effective rate.

Built as a static site: plain HTML, CSS, and vanilla JavaScript. No build step, no backend, no tracking. All scenarios and preferences are stored locally in your browser.

## Features

- **Sell side.** Models a seller's net proceeds. The default **all-in closing %** mode applies a single percentage of the sale price and works anywhere: the listing and buyer's-agent commission fields plus a ≈2.5% title/escrow/transfer baseline drive the number (defaults to 8%, the low end of the 8–10% national average), and it auto-adjusts as you change the commissions — selling it yourself? Set the listing side to 0. You can also override it directly with the slider or by typing. An optional **Texas net sheet** preset instead itemizes the owner's title policy (Texas TDI basic premium rates effective March 1, 2026 — with a toggle for who pays it), escrow/recording fees, and property-tax proration to the closing date.
- **Buy side.** Purchase price, down payment (with a one-click "use all proceeds"), and the resulting loan amount and leftover cash.
- **Destination-driven property tax.** Choose the state you're buying in and the property-tax rate auto-fills from that state's average effective rate — editable for the specific parcel.
- **Financing & carry.** Rate, term, property-tax rate, insurance, and HOA roll up into an estimated monthly payment (principal & interest, taxes, insurance, HOA) with a visual breakdown.
- **Editable route.** Name where you're selling and buying; the labels appear in the header and in saved scenarios.
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

All figures are estimates. Lender quotes, actual parcel tax bills, and insurance premiums will vary — confirm specifics with your lender, title company, and county assessor. State property-tax rates are average effective rates (approximate, from public Tax Foundation / ATTOM data) and stay editable. The default input values are illustrative placeholders, not real figures.
