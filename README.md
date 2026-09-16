# plugin-screener

Stock screener for [Jaspers Terminal](https://github.com/JaspersAI), an open source, extensible desktop terminal for financial research.

One view, `screener/screener`: a table of companies that file 10-Ks with the SEC, filtered by sector, index, exchange, and ranges on 43 fields, sorted by any column. Ask the assistant for a screen ("software companies growing revenue over 20%") and it sets the filters; ask a qualitative question ("which of these sell to the federal government?") and the view runs it over the filings and pins the matches.

## Install

In Jaspers Terminal, open Settings > Plugins, paste

```
https://github.com/JaspersAI/plugin-screener
```

and press Install. The app downloads the latest release, shows where it came from, and asks before any of it runs. A plugin runs code on your computer with your permissions, so install plugins only from people you trust.

## Keys

- **Jaspers API key**, from your Jaspers account.

The app asks for it the first time the screener runs, or take it in Settings > Plugins. It is sealed in your OS keychain and never reaches the plugin or the assistant.

## Needs

Nothing else.

## Develop

```sh
git clone https://github.com/JaspersAI/plugin-screener.git ~/Jaspers/plugins/screener
cd ~/Jaspers/plugins/screener
npm install
npm run typecheck
npm test
```

A folder you put in `~/Jaspers/plugins` is a plugin of your own, which the app rebuilds whenever you save. If this plugin is installed, remove it in Settings > Plugins first: the clone goes where the installed copy lives. Types come from [`@jaspers-ai/sdk`](https://www.npmjs.com/package/@jaspers-ai/sdk), which the app provides at run time.

## Release

Bump `version` in `package.json`, commit, and push a tag:

```sh
npm version patch
git push --follow-tags
```

The Release workflow checks the plugin and attaches `screener-<version>.zip` to a GitHub release. Update in Settings > Plugins picks it up.

## License

[MIT](LICENSE)
