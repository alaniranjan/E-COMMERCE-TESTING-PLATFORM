Application: SauceDemo practice web shop.
Pages: Login -> Products -> Product details -> Cart -> Checkout: Your Information -> Checkout: Overview -> Checkout: Complete.
Products page: 6 products with name, description, price and an "Add to cart" button (changes to "Remove"). Sort options: Name (A to Z), Name (Z to A), Price (low to high), Price (high to low).
Cart: the cart icon badge shows the item count. Items can be removed on the Products and Cart pages. The cart survives a page reload.
Checkout flow: Cart page "Checkout" button -> Checkout: Your Information (First Name, Last Name, Postal Code, all required) -> "Continue" -> Checkout: Overview -> "Finish" -> Checkout: Complete.
Checkout information errors: a missing value shows "Error: First Name is required" (or "Error: Last Name is required", "Error: Postal Code is required"). There is no format validation of the postal code.
Checkout overview: lists items, Item total, Tax (8% of item total), Total. "Finish" places the order; "Cancel" returns to Products.
Order complete: header "Thank you for your order!", cart badge cleared, "Back Home" returns to Products.
Users: standard_user (normal), locked_out_user (login refused: "Epic sadface: Sorry, this user has been locked out."), problem_user, performance_glitch_user. All share one password.
Login errors: empty username -> "Epic sadface: Username is required"; wrong credentials -> "Epic sadface: Username and password do not match any user in this service".
Controlled test API (separate from the website): REST /api/auth/login (bearer token), /api/products, /api/cart/items (quantity 1-10), /api/orders (8% tax, empty cart rejected with 400).
