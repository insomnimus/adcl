/** A command line argument/flag/option.
 *
 * It can take 3 forms:
 * 1. A positional. If you specify no `flags`, it'll be a positional.
 * 2. A boolean flag. If you specify at least 1 flag and do not specify `takesValue = true`, it'll be a boolean flag.
 * 3. An option that takes a value. Specify at least 1 flag and `takesValue = true`. */

export interface Arg {
	/** The argument must exist and have a value. Has no effect if `takesValue` is false or undefined. */
	required?: boolean;
	/** Specify a default value. Implies `takesValue = true` and `required = false`. */
	default?: string;
	/** The help message of this argument. */
	help?: string;
	/** A list of flags. Leading hyphons (`-`) will be trimmed.
	 * If left unspecified or set to `[]`, the argument becomes a positional and `takesValue` is implied.
	 * Values with 1 length become short flags while longer values become long flags.
	 * An empty value is an error and the behaviour is unspecified. */
	flags?: string[];
	/** A set of possible values for this Arg.
	 *
	 * - This implies `takesValue = true`.
	 * - This superseeds `validate` (in fact, it replaces it). */
	possible?: string[];
	/** Do case insensitive comparison for values in `possible`.
	 * Has no effect if `possible` is `undefined` or empty. */
	ignoreCase?: boolean;
	/** If set to `true`, the flag can be specified multiple times and the return value will be `string[]` if it takes value, otherwise the number of occurrences.*/
	multi?: boolean;
	/** Specify that the flag takes a value.*/
	takesValue?: boolean;
	/** Validation callback. If specified, the callback will be provided the value the flag took.
	 * If the callback returns `undefined`, the value is accepted. Otherwise an error message will be displayed with the contents being the return value.
	 *
	 * Note that you don't need to write "error: ..." since that is automatically done by clad.
	 * - This implies `takesValue = true`.
	 * - Setting `possible` to a non-empty array will superseed and replace this field. */
	validate?(value: string): string | undefined;
	/** Specify that using this argument conflicts with another.
	 * In order for it to succeed, none of the flags provided must be present in runtime.
	 * > The values are the keys and not flags themselves. E.g do not use `"--bla"`, use the name of the key. */
	conflicts?: string[];
	/** Specify that using this argument requires another to be present.
	 * In order for it to be successful, every flag specified must be present.
	 * > The values are the keys and not flags themselves. E.g do not use `"--bla"`, use the name of the key. */
	requires?: string[];
	/** Require *this* arg to be set unless any of these flags are present.*/
	requiredUnlessAny?: string[];
	/** Require *this* arg to be set if none of these flags are present.*/
	requiredUnlessAll?: string[];
}

export interface ArgState extends Arg {
	key: string;
	name: string;
	isPositional: boolean;
	occurrences: number;
	vals: string[];
}

/** A map of arguments.
 *
 * The order is preserved during parsing and automatic help generation.
 * The keys are strings and they will be used in automatic help generation. */
type Args = {
	[name: string]: Arg;
};

/** The return value after parsing.*/
export interface ArgMatches {
	/** The flags that take only 1 argument (as in, `takesValue = true, multi = false`).*/
	str: { [name: string]: string };
	/** The flags that take multiple values (as in, `takesValue = true, multi = true`).*/
	arr: { [name: string]: string[] };
	/** Boolean flags (no value). The values are the number of occurrences, which can be used as truthy values as well as numbers.*/
	bool: { [name: string]: number };
}

/** The command.*/
export class Command {
	#name: string;
	#about?: string;
	#args: Map<string, ArgState>;
	#throwOnError = false;
	#fresh = true;
	#version?: string;

	/** Constructs a new `Command` instance with the given flags.
	 * It will throw an exception if the input is invalid.
	 * This includes input like a positional with `multi` not being the last positional. */
	constructor(appName: string, args: Args) {
		this.#name = appName;
		this.#args = new Map<string, ArgState>();
		let lastPositional = -1;
		let firstMultiPositional = -1;

		for (const [i, [k, v]] of Object.entries(args).entries()) {
			if (v.possible?.length) {
				v.takesValue = true;
				const ignoreCase = v.ignoreCase ?? false;
				const possible = v.possible!;
				v.validate = s => {
					const sx = ignoreCase ? s.toUpperCase() : s;
					for (const val of possible) {
						if (sx === (ignoreCase ? val.toUpperCase() : val)) return undefined;
					}
					return `value must be one of [${possible.join(", ")}]`;
				};
			}
			for (const other of v.conflicts ?? []) {
				if (!args[other]) {
					throw `the arg ${k} specifies a conflict with a non-existing argument ${other}`;
				} else if (other === k) {
					throw `the argument ${k} specifies a conflict with itself`;
				}
			}
			for (const other of v.requires ?? []) {
				if (!args[other]) {
					throw `the arg ${k} specifies a non-existing argument (${other}) as required`;
				} else if (k === other) {
					throw `the argument ${k} specifies a requirement for itself`;
				}
			}
			if (v.validate !== undefined) v.takesValue = true;
			if (v.default !== undefined) {
				v.required = false;
				v.takesValue = true;
			}
			let isPositional = false;
			v.flags = v.flags ?? [];
			for (let i = 0; i < v.flags.length; i++) {
				if (v.flags[i].startsWith("-")) {
					v.flags[i] = v.flags[i].replace(/^\-+/, "");
				}
			}

			let name: string;
			// if it isn't positional
			if (v.flags!.length !== 0) {
				const shorts = v.flags!.filter(x => x.length === 1);
				const longs = v.flags!.filter(x => x.length > 1);
				if (shorts.length > 0 && longs.length > 0) {
					name = `-${shorts[0]} --${longs[0]}`;
				} else if (shorts.length > 0) name = "-" + shorts[0];
				else if (longs.length > 0) name = "--" + longs[0];
				else throw `option '${k}' contains an empty flag`;
				if (v.takesValue) name += ` <${k}${v.multi ? "..." : ""}>`;
			} else {
				isPositional = true;
				lastPositional = i;
				if (v.multi && firstMultiPositional < 0) firstMultiPositional = i;
				name = `<${k}${v.multi ? "..." : ""}>`;
			}
			v.takesValue = v.takesValue || isPositional;

			this.#args.set(k, {
				...v,
				key: k,
				occurrences: 0,
				vals: [],
				name: name,
				isPositional: isPositional,
			});
		}

		if (firstMultiPositional >= 0 && firstMultiPositional < lastPositional) {
			throw "positionals with multiple values are only allowed as the last positional";
		}
	}

	/** Set the apps `about` message.
	 * You can chain a call to this function (it returns `this`). */
	about(msg: string): Command {
		this.#about = msg;
		return this;
	}

	/** Give this command a version.
	 *
	 * You can chain this method (it returns `this`).
	 * > This will enable the version flags if they don't exist: `-V` and `--version`. */
	version(version: string): Command {
		this.#version = version;
		return this;
	}

	/** Throw an exception instead of exiting the app when the input doesn't validate.*/
	throwOnError(yes: boolean): Command {
		this.#throwOnError = yes;
		return this;
	}

	#shorts(): Map<string, boolean> {
		const map = new Map<string, boolean>();
		for (const arg of this.#args.values()) {
			for (const s of arg.flags!.filter(s => s.length === 1)) {
				map.set(s, arg.takesValue ?? false);
			}
		}
		return map;
	}

	#longs(): Map<string, boolean> {
		const map = new Map<string, boolean>();
		for (const arg of this.#args.values()) {
			for (const s of arg.flags!.filter(s => s.length > 1)) {
				map.set(s, arg.takesValue ?? false);
			}
		}
		return map;
	}

	#get(s: string): ArgState | undefined {
		if (s.startsWith("--")) {
			if (s.length == 3) return undefined;
			const name = s.substring(2);
			return find(this.#args.values(), x => x.flags?.includes(name) ?? false);
		} else if (s.length > 1 && s.startsWith("-")) {
			const name = s.substring(1);
			return find(this.#args.values(), x => x.flags?.includes(name) ?? false);
		} else {
			// find the first positional that has no value

			const positionals = [];
			for (const x of this.#args.values()) {
				if (x.isPositional) positionals.push(x);
			}

			if (positionals.length === 0) return undefined;
			const arg = positionals.find(x => x.occurrences === 0);
			if (arg) return arg;
			// or return the last positional if it's multi
			if (positionals[positionals.length - 1].multi) {
				return positionals[positionals.length - 1];
			} else return undefined;
		}
	}

	#versionAndExit(): never {
		console.log(`${this.#name} ${this.#version ?? "unknown version"}`);
		process.exit(0);
		while (true) {}
	}

	#helpAndExit(_long: boolean): never {
		const positionals: ArgState[] = [];
		const opts: ArgState[] = [];
		let shortHelp = true;
		let longHelp = true;
		let shortVersion = this.#version !== undefined;
		let longVersion = this.#version !== undefined;

		for (const x of this.#args.values()) {
			if (x.isPositional) positionals.push(x);
			else {
				opts.push(x);
				if ((shortHelp || longHelp || shortVersion || longVersion) && x.flags) {
					for (const s of x.flags) {
						switch (s) {
							case "-V":
								shortVersion = false;
								break;
							case "--version":
								longVersion = false;
								break;
							case "-h":
								shortHelp = false;
								break;
							case "--help":
								longHelp = false;
								break;
						}
					}
				}
			}
		}

		const hasOpt = shortHelp || longHelp || shortVersion || longVersion || opts.length > 0;
		const sOpt = hasOpt ? " [OPTIONS]" : "";
		const sPos = positionals.length > 0 ? " ARGS..." : "";
		console.log(`USAGE: ${this.#name}${sOpt}${sPos}`);
		if (this.#about) console.log(this.#about);

		if (hasOpt || positionals.length !== 0) console.log("");

		if (hasOpt) {
			console.log("OPTIONS:");
			for (const opt of opts) {
				console.log("    " + argHelp(opt));
			}

			let help = "";
			let ver = "";
			if (shortHelp && longHelp) help = "-h, --help";
			else if (shortHelp) help = "-h";
			else if (longHelp) help = "--help";

			if (shortVersion && longVersion) ver = "-V, --version";
			else if (shortVersion) ver = "-V";
			else if (longVersion) ver = "--version";

			if (ver !== "") console.log(`    ${ver}: Show version information and exit`);
			if (help !== "") console.log(`    ${help}: Show this message and exit`);
		}

		if (positionals.length !== 0) {
			if (hasOpt) console.log("");
			console.log("ARGS:");
			for (const arg of positionals) {
				console.log("    " + argHelp(arg));
			}
		}

		process.exit(0);
		while (true) {}
	}

	#errAndExit(msg: string, suggestHelp = true): never {
		if (this.#throwOnError) throw `argument validation failed: ${msg}`;

		console.log(`error: ${msg}`);
		if (suggestHelp) console.log("run with --help for more info");

		process.exit(1);
		while (true) {}
	}

	#preprocess(argv: string[]): string[] {
		const processed: string[] = [];
		const shorts = this.#shorts();
		const longs = this.#longs();

		for (let pos = 0; pos < argv.length; pos++) {
			const s = argv[pos];
			if (s === "--") {
				processed.push(...argv.slice(pos));
				break;
			}

			if (s.startsWith("--")) {
				// Split --arg=val to --arg val
				const index = s.indexOf("=");

				if (index < 0) {
					processed.push(s);
					// shift the position to consume the value if the flag exists and takes a value
					if (longs.get(s.substring(2))) {
						pos++;
						if (pos < argv.length) processed.push(argv[pos]);
					}
				} else {
					processed.push(s.substring(0, index));
					processed.push(s.substring(index + 1));
				}
			} else if (s.length > 1 && s.startsWith("-")) {
				for (let i = 1; i < s.length; i++) {
					// if flag exists and takes value
					if (shorts.get(s[i])) {
						processed.push("-" + s[i]);
						const rest = s.substring(i + 1);
						if (rest === "") {
							// shift position and push value
							pos++;
							if (pos < argv.length) processed.push(argv[pos]);
						} else if (rest.startsWith("=")) {
							processed.push(rest.substring(1));
						} else {
							processed.push(rest);
						}
						// done with the char iteration
						break;
					} else {
						// push the character prepended with "-"
						processed.push("-" + s[i]);
					}
				}
			} else {
				// it's a positional
				processed.push(s);
			}
		}

		return processed;
	}

	#reset() {
		for (const flag of this.#args.values()) {
			flag.occurrences = 0;
			flag.vals = [];
		}

		this.#fresh = true;
	}

	/** Parse command line arguments and return an object with their values.
	 *
	 * Provide the command line arguments to this method. */
	parseFrom(argv: string[]): ArgMatches {
		if (!this.#fresh) this.#reset();
		this.#fresh = false;
		argv = this.#preprocess(argv);

		for (let pos = 0; pos < argv.length; pos++) {
			const s = argv[pos];
			// After --, only take positional arguments
			if (s === "--") {
				for (pos = pos + 1; pos < argv.length; pos++) {
					// using an empty string here can only return positionals which is what we want.
					const arg = this.#get("");
					if (arg !== undefined) {
						arg.occurrences++;
						arg.vals.push(argv[pos]);
					} else {
						this.#errAndExit(`unexpected value ${argv[pos]}`);
					}
				}
				break;
			}
			const flag = this.#get(s);
			if (flag === undefined) {
				if (s === "-h" || s === "--help") this.#helpAndExit(false);
				else if (this.#version && (s === "-V" || s === "--version")) {
					this.#versionAndExit();
				} else if (s.startsWith("-")) {
					this.#errAndExit(
						`unknown option \`${s}\`\nif you meant to supply \`${s}\` as a value rather than a flag, use \`-- ${s}\``,
					);
				} else this.#errAndExit(`unexpected value \`${s}\``);
			}

			flag.occurrences++;
			if (flag.takesValue) {
				// if it's positional, do not shift argv
				if (flag.isPositional) flag.vals.push(s);
				else {
					pos++;
					if (pos >= argv.length) {
						this.#errAndExit(`the argument ${flag.name} requires a value but none was supplied`);
					}
					flag.vals.push(argv[pos]);
				}
			}
		}

		// Validation
		for (const flag of this.#args.values()) {
			if (flag.occurrences > 0 && flag.conflicts?.length) {
				for (const other of flag.conflicts!.map(x => this.#args.get(x))) {
					if (other!.occurrences > 0) {
						this.#errAndExit(`${flag.name} cannot be used together with ${other?.name}`, false);
					}
				}
			}
			if (flag.occurrences > 0 && flag.requires?.length) {
				for (const other of flag
					.requires!.map(s => this.#args.get(s))
					.filter(x => x !== undefined && x.default === undefined)) {
					if (other!.occurrences === 0) {
						this.#errAndExit(`using ${flag.name} requires ${other!.name} to be present`, false);
					}
				}
			}

			// check requiredUnlessAny
			if (flag.requiredUnlessAny?.length && flag.occurrences === 0 && flag.default === undefined) {
				const others = flag
					.requiredUnlessAny!.map(x => this.#args.get(x))
					.filter(x => x !== undefined);
				let exists = others.length === 0;
				for (const other of others) {
					if (other!.default !== undefined || other!.occurrences > 0) {
						exists = true;
						break;
					}
				}
				if (!exists) {
					if (others.length === 1)
						this.#errAndExit(`at least one of ${flag.name} or ${others[0]!.name} must be present`);
					else
						this.#errAndExit(
							`at least one of ${others.map(x => x!.name).join(", ")} or ${
								flag.name
							} must be present`,
						);
				}
			}

			// check requiredUnlessAll
			if (flag.requiredUnlessAll?.length && flag.occurrences === 0 && flag.default === undefined) {
				const others = flag
					.requiredUnlessAll!.map(x => this.#args.get(x))
					.filter(x => x !== undefined);
				if (
					others.length > 0 &&
					!others.every(x => x!.default !== undefined || x!.occurrences > 0)
				) {
					if (others.length === 1)
						this.#errAndExit(`at least one of ${flag.name} or ${others[0]!.name} must be present`);
					else
						this.#errAndExit(
							`at least ${flag.name} or all of [${others
								.map(x => x!.name)
								.join(", ")}] must be present`,
						);
				}
			}

			if (!flag.multi && flag.occurrences > 1) {
				this.#errAndExit(`${flag.name} can be specified only once`);
			} // flags are always optional
			else if (!flag.takesValue) continue;
			else if (flag.required && flag.occurrences === 0) {
				this.#errAndExit(`missing required value for ${flag.name}`);
			}
			if (flag.occurrences === 0 && flag.default !== undefined) {
				flag.vals = [flag.default!];
			}
			for (const val of flag.vals) {
				const res = flag.validate === undefined ? undefined : flag.validate(val);
				if (res !== undefined) {
					this.#errAndExit(`failed to validate the \`${val}\` value of ${flag.name}: ${res}`);
				}
			}
		}

		// everything is fine
		const obj: ArgMatches = { str: {}, arr: {}, bool: {} };
		for (const [key, v] of this.#args.entries()) {
			if (!v.takesValue) obj.bool[key] = v.occurrences;
			else if (v.multi) obj.arr[key] = v.vals;
			else if (v.vals.length > 0) obj.str[key] = v.vals[0];
		}
		return obj;
	}

	/** Parse command line arguments from `process.argv` and return an object with their values.
	 *
	 * Equivalent to `Command.parseFrom(process.argv.slice(2))`. */
	parse(): ArgMatches {
		return this.parseFrom(process.argv.slice(2));
	}
}

function argHelp(arg: ArgState): string {
	const def = arg.default !== undefined ? ` [default: ${arg.default}]` : "";
	const possible = arg.possible?.length ? ` [possible values: ${arg.possible!.join(", ")}]` : "";
	const req = !arg.takesValue || !arg.required ? "" : " (required)";
	const multi = arg.multi ? "..." : "";
	const valname = arg.isPositional || arg.takesValue ? `<${arg.key}>` : "";
	const flags = (arg.flags?.filter(x => x.length === 1) ?? [])
		.map(x => "-" + x)
		.concat((arg.flags?.filter(x => x.length > 1) ?? []).map(x => "--" + x))
		.join(", ");
	const sep = flags.length !== 0 && arg.takesValue ? " " : "";

	return `${flags}${sep}${valname}${multi}: ${
		arg.help ?? "No help provided"
	}${req}${possible}${def}`;
}

function find<T, F extends { (x: T): boolean }>(iter: IterableIterator<T>, fn: F): T | undefined {
	for (const x of iter) if (fn(x)) return x;
	return undefined;
}
