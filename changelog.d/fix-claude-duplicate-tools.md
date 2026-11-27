### Fixed

- Claude agents work again. In v0.42.0, every message to a Claude agent stopped with the error
  "Tool search_memories is already registered", because two GoAhead tools were listed two times.
  The HTML preview and HTML page tools were also listed two times; each is now listed once.
