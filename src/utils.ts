import { tokens } from "./tokens";
import tinycolor from "tinycolor2";
import { get } from "lodash-es";

// Source: https://www.figma.com/plugin-docs/api/VariableResolvedDataType/
type VariableType = VariableResolvedDataType;

// Modes you are supporting
// Example: ["light", "dark", "high-contrast"]
const SUPPORTED_MODES = ["light", "dark"] as const;

/**
 * This is the supported mode alongside it's id
 * Example:
 *  {
 *    light: { id: "1234" },
 *    dark: { id: "5678" }
 *  }
 */
type ModeMapType = {
  [mode in (typeof SUPPORTED_MODES)[number]]: { id: string };
};

type VariableMapType = {
  [variableName: string]: Variable;
};

/**
 * Transformation map.
 * Those are used to transform
 * the value before creating the variable.
 */
const DefaultValueTransforms = {
  "px-to-number": (raw: Record<string, any>) => {
    if (typeof raw.value !== "string") {
      throw new Error("Wrong token");
    }
    return parseInt(raw.value.replace("px", ""));
  },
  "hex-to-rgba": (raw: Record<string, any>) => {
    if (typeof raw.value !== "string") {
      throw new Error("Wrong token");
    }
    const color = tinycolor(raw.value).toRgb();
    color.r = color.r / 255;
    color.g = color.g / 255;
    color.b = color.b / 255;
    color.a = 1; // in the example tokens all have alpha of 1
    return color;
  },
};

type TransformType = {
  /** Name of the token, if you want grouping in Figma concat with "/" */
  name: string;
  type: VariableType;
  /**
   * Receives the path of the token
   * as an array of strings.
   * Example: ["colors", "primary", "500"]
   */
  getName: (path: string[]) => string;
  /**
   * Callback for transforming the value
   * Example: "6px" -> 6
   **/
  getValue?: (raw: Record<string, any>) => VariableValue;
};

/**
 * Current token structure in Figma.
 * `name` acts as a simple match pattern,
 * with `*` as a wildcard.
 *
 * Feel free to modify to work with your structure.
 * 1. colors/primary/(number)
 * 2. breakpoints/(string)
 * 3. theme/{theme}/palette/primary/(number)
 *
 */
const TransformMaps: TransformType[] = [
  {
    name: "corner",
    type: "FLOAT",
    getName: (path) => path.join("/"),
    getValue: DefaultValueTransforms["px-to-number"],
  },
  {
    name: "color",
    type: "COLOR",
    getName: (path) => path.join("/"),
    getValue: DefaultValueTransforms["hex-to-rgba"],
  },
  {
    name: "theme/*",
    type: "COLOR",
    // Example input: ["theme", "light", "background"]
    // Output name: "themed/background"
    getName: (path) => `themed/${path.slice(2).join("-")}`,
    getValue: DefaultValueTransforms["hex-to-rgba"],
  },
];

/** Style-Dictionary to Tokens */
export class SD2Tokens {
  /** The name of the collection you want to update */
  TARGET_COLLECTION = "Demo Collection";
  // Their ids with dot notation (lodash.get)
  // Example ["colors.primary.500"]
  Aliases: string[] = [];

  private collection: VariableCollection;
  private variablesMap: VariableMapType;
  private modesMap: ModeMapType;

  constructor() {
    const collections = figma.variables.getLocalVariableCollections();
    const collection = collections.find(
      (collection) => collection.name === this.TARGET_COLLECTION,
    );
    if (!collection) throw new Error("Collection not found");
    this.collection = collection;

    // Initialise variables map
    this.variablesMap = collection.variableIds.reduce(
      (acc, variableId) => ({
        ...acc,
        [variableId]: figma.variables.getVariableById(variableId),
      }),
      {},
    ) as VariableMapType;

    // Initialise modes map
    this.modesMap = collection.modes.reduce(
      (acc, mode) => ({
        ...acc,
        [mode.name]: { id: mode.modeId },
      }),
      {},
    ) as ModeMapType;
  }

  public updateTokens() {
    this.dfs(tokens);

    // Create aliases
    this.Aliases.forEach((alias) => {
      console.log("Aliassssss");
      this.createAlias({ aliasedTokenName: alias });
    });
  }

  // Iterate all the tokens recursively
  public dfs(obj: Record<string, any>) {
    // Base case check
    if (obj.value === undefined) {
      Object.keys(obj).forEach((key) => {
        this.dfs(obj[key]);
      });
      return;
    } else {
      console.log("Continued");
      console.log(obj.path);
      // Base case, proceeding to variable creation.
      // Find transform type from TransformMaps
      const transformType = this.findTransformType(obj);
      console.log(transformType);
      if (!transformType) return; // tokens should not create variable

      const {
        transformedValue: value,
        transformedName: name,
        transform,
      } = transformType;

      console.info(`Creating token: ${name}`);
      let variable: Variable;

      // Check if variable already exists
      const existingVariable = this.findExistingVariable(name);
      if (existingVariable) {
        variable = existingVariable;
      } else {
        variable = figma.variables.createVariable(
          name,
          this.collection.id,
          transform.type,
        );
      }

      // Update VariablesMap
      this.variablesMap[variable.id] = variable;

      const isAlias = obj.original.value.includes("{"); // Hacky way, not sure if there is a better way

      if (isAlias) {
        // Push path to Aliases to reference later with lodash.get
        this.Aliases.push(obj.path.join("."));
      } else {
        // Modify variable directly
        this.modifyVariable({
          value,
          variable,
          name,
        });
      }
    }
  }

  /**
   * This function will not work in multi-alias cases
   * like a->b->c->d but rather on simple aliases (1 level) a->b
   * @param opts.aliasedTokenName Dot notation to access with lodash.get
   */
  public createAlias(opts: { aliasedTokenName: string }) {
    const { aliasedTokenName } = opts;
    console.log(`Alias creation: ${aliasedTokenName}`);

    const obj = get(tokens, aliasedTokenName);
    if (!obj) return;

    const theme = obj.path.find((path: string) =>
      (SUPPORTED_MODES as unknown as string[]).includes(path),
    ) as (typeof SUPPORTED_MODES)[number] | undefined;

    const transformType = this.findTransformType(obj);
    if (!transformType) return;

    const { transformedValue, transform, transformedName } = transformType;

    let variable = this.findExistingVariable(transformedName);
    if (!variable) {
      variable = figma.variables.createVariable(
        transformedName,
        this.collection.id,
        transform.type,
      );
    }

    // If the variable includes alpha channel,
    // skipping creating alias, and create a new variable instead
    // as alpha channel is not supported in Figma to aliases
    // Neo4j Specific, feel free to remove
    if (obj.alpha) {
      // Create the value directly
      this.modifyVariable({
        name: transformedName,
        value: transformedValue,
        theme,
        variable,
      });
    } else {
      // Create the alias case

      // Find the aliased variable
      const aliasedDotNotationName = obj.original.value
        .replace(".value", "")
        .replace("{", "")
        .replace("}", "");
      const aliasedObj = get(tokens, aliasedDotNotationName);
      if (!aliasedObj) return;

      const aliasedTransformType = this.findTransformType(aliasedObj);
      if (!aliasedTransformType) return;

      const { transformedName } = aliasedTransformType;
      const aliasedVariable = this.findExistingVariable(transformedName);
      if (!aliasedVariable)
        throw new Error("Aliased variable does not exist? 🤔");

      if (theme) {
        variable.setValueForMode(this.modesMap[theme].id, {
          type: "VARIABLE_ALIAS",
          id: aliasedVariable.id,
        });
      } else {
        Object.keys(this.modesMap).forEach((key) => {
          const mode = key as keyof ModeMapType;
          // Type-guard "variable"
          variable &&
            variable.setValueForMode(this.modesMap[mode].id, {
              type: "VARIABLE_ALIAS",
              id: aliasedVariable.id,
            });
        });
      }
    }
  }

  /**
   * Modifies a Figma variable's value
   * @param opts.value Can be a raw value or an alias
   * @param opts.name The token's name
   * @param opts.variable Variable object
   */
  private modifyVariable(opts: {
    value: any;
    name: string;
    variable: Variable;
    theme?: (typeof SUPPORTED_MODES)[number];
  }) {
    const { value, name, variable, theme } = opts;
    console.log(`Modifying variable: ${name}`);

    try {
      if (theme) {
        variable.setValueForMode(this.modesMap[theme].id, value);
      } else {
        /**
         * If value is not themed, we set the same value
         * for all the modes that exist in the collection.
         */
        Object.keys(this.modesMap).forEach((key) => {
          const mode = key as keyof ModeMapType;
          variable.setValueForMode(this.modesMap[mode].id, value);
        });
      }
    } catch (e) {
      console.info("Error in alias creation");
      console.log(e);
    }
  }

  /**
   * Searches through existing variables to find a
   * variable with the same name, if it exists.
   */
  private findExistingVariable(name: string) {
    const key = Object.keys(this.variablesMap).find((variableName) => {
      const variable = this.variablesMap[variableName];
      return variable.name === name;
    });
    return key ? this.variablesMap[key] : undefined;
  }

  private findTransformType(obj: Record<string, unknown>):
    | {
        transformedName: string;
        transformedValue: VariableValue;
        transform: TransformType;
      }
    | undefined {
    const path = obj.path as string[];
    const transform = TransformMaps.find((transform) => {
      const transformName = transform.name;

      const nameParts = transformName.split("/");

      return nameParts.every((part, index) => {
        return part === "*" || part === path[index];
      });
    });

    if (!transform) return undefined;

    return {
      transform: transform,
      transformedName: transform.getName(path),
      transformedValue: transform.getValue
        ? transform.getValue(obj)
        : (obj.value as VariableValue),
    };
  }
}
