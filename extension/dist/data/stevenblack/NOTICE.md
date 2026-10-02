# Bundled StevenBlack data

This folder contains data from the official [StevenBlack/hosts project](https://github.com/StevenBlack/hosts), unified base + fakenews + gambling + porn + social. `metadata.json` identifies the immutable revision and SHA-256 digest; `hosts` retains the original source comments.

`license.txt` is Steven Black's project license. The aggregated source lists have their own terms, including MIT, Creative Commons attribution/share-alike, and noncommercial licenses. The project license does not replace those source terms. `upstream-readme.md` retains upstream attribution, source links, and the license table for this variant. Preserve these notices with the bundled data and review the source terms when preparing a distribution.

The extension imports hostnames as data; it never runs upstream code. Runtime parsing skips names outside AtlasCore's supported hostname contract. This is a prototype snapshot, not a promise that every upstream entry is valid or that the dataset stays current without refresh.
