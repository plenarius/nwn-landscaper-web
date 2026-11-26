<!-- markdownlint-disable-file MD041 -->
- **A long descent no longer shows as blocked.** A new *Descending cave* showed "68 blocked" in the live check, though every
  route in it is walkable: NWN's route search gives up when the way is about 20 tiles longer than going straight there, so
  one click from one end of the descent to the other stops, and two or three shorter clicks get there. With an engine that
  tells these routes apart (`routes.long`), the live check says *Paths OK* and its tooltip counts them, and Check paths says
  how many are too long for one click and how many clicks they take. Blocked routes stay red as before.
