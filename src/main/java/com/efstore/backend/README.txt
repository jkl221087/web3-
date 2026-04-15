This patch keeps existing frontend-compatible fields and APIs, while adding:
- order risk / screening / freeze / payout-block fields
- risk_cases table and admin endpoints
- payout review fields
- safer audit detail maps (avoid Map.of null crashes)

Files replaced:
- Models.java
- StoreSupport.java
- StoreService.java
- ApiController.java

No change needed:
- Application.java
- AuthService.java
