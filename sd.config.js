const StyleDictionary = require("style-dictionary");

StyleDictionary.registerFormat({
  name: "javascript/exported",
  formatter: function ({ dictionary, platform, options, file }) {
    return `export const tokens = ${JSON.stringify(
      dictionary.tokens,
      null,
      2,
    )}`;
  },
});

module.exports = {
  source: ["tokens/tokens.json"],
  platforms: {
    js: {
      transformGroup: "js",
      buildPath: "src/",
      files: [
        {
          destination: "tokens.js",
          format: "javascript/exported",
        },
      ],
    },
  },
};
