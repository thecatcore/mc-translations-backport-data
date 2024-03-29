import { writableStreamFromWriter } from "https://deno.land/std@0.192.0/streams/writable_stream_from_writer.ts";
import { exists } from "https://deno.land/std@0.192.0/fs/exists.ts";
import { emptyDir } from "https://deno.land/std@0.192.0/fs/empty_dir.ts";
import { move } from "https://deno.land/std@0.192.0/fs/move.ts";
import { decompress } from "https://deno.land/x/zip@v1.2.5/decompress.ts";
import { filterKeys } from "https://deno.land/std@0.192.0/collections/filter_keys.ts";
import { filterValues } from "https://deno.land/std@0.192.0/collections/filter_values.ts";

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

const versionDetails = "https://skyrising.github.io/mc-versions/version/{}.json";

const versionListFile = await fetch("https://skyrising.github.io/mc-versions/version_manifest.json");
const versionManifest = await versionListFile.json();

console.log("Downloading mc jars...");

if (!(await exists("./jars"))) {
    await Deno.mkdir("./jars")
}

if (!(await exists("./original"))) {
    await Deno.mkdir("./original")
}

if (!(await exists("./translated_original"))) {
    await Deno.mkdir("./translated_original")
}

if (!(await exists("./diff"))) {
    await Deno.mkdir("./diff")
}

if (!(await exists("./translated"))) {
    await Deno.mkdir("./translated")
}

const noClient = []

for (const i in versionManifest["versions"]) {
    const id: string = versionManifest["versions"][i]["id"];
    const type: string = versionManifest["versions"][i]["type"];

    if (await exists(`./original/${id}.json`)) continue;

    if (!await exists(`./jars/${id}.jar`)) {
        try {
            const versionInfo = await (await fetch(versionDetails.replace("{}", id))).json();

            if (type != "old_alpha" && type != "alpha_server" && type != "classic_server") {
                if (versionInfo["downloads"]["client"]) {
                    const jarFile = await fetch(versionInfo["downloads"]["client"]["url"])

                    if (jarFile.body) {
                        const jarPath = await Deno.open(`./jars/${id}.jar`, { write: true, create: true });

                        const writableStream = writableStreamFromWriter(jarPath);
                        await jarFile.body.pipeTo(writableStream);

                        console.log(id);
                    }
                } else {
                    noClient.push(id);
                }
            }
        } catch (e) {
            if (await exists(`./original/${id}.json`)) continue;

            throw e;
        }
    }
}

console.log("DONE");

await emptyDir("./cache")

console.log("Extracting lang file...")

for await (const dirEntry of Deno.readDir("./jars")) {
    const name = dirEntry.name;

    const version = name.replace(".jar", "");

    if (await exists(`./original/${version}.json`)) continue;

    await decompress(`./jars/${name}`, "./cache");

    if (await exists(`./cache/assets/minecraft/lang/en_us.json`)) {
        await move(`./cache/assets/minecraft/lang/en_us.json`, `./original/${version}.json`);
    } else if (await exists(`./cache/assets/minecraft/lang/en_us.lang`)) {
        const data = await readLangFromFile(`./cache/assets/minecraft/lang/en_us.lang`, false);
        await writeLangFile(`./original/${version}.json`, data, true);
    } else if (await exists(`./cache/assets/minecraft/lang/en_US.lang`)) {
        const data = await readLangFromFile(`./cache/assets/minecraft/lang/en_US.lang`, false);
        await writeLangFile(`./original/${version}.json`, data, true);
    } else if (await exists(`./cache/lang/en_US.lang`)) {
        const data = await readLangFromFile(`./cache/lang/en_US.lang`, false);

        if (await exists(`./cache/lang/stats_US.lang`)) {
            const data2 = await readLangFromFile(`./cache/lang/stats_US.lang`, false);

            for (const key in data2) {
                data[key] = data2[key];
            }
        }

        await writeLangFile(`./original/${version}.json`, data, true);
    }

    await emptyDir("./cache");
}

console.log("DONE")

console.log("Generating diff between lang files...")

let current = versionManifest["versions"][0]["id"];

await Deno.remove("./diff_info.json");
const versionFromVersion: Record<string, string> = {};

while (current != "b1.0") {
    const versionManifest = await fetch(versionDetails.replace("{}", current));
    const versionJson = await versionManifest.json();

    let version = versionJson["previous"][0];

    if (version == "b1.6-pre-trailer") {
        version = "b1.5_01"
    }

    if (version == "b1.3-1731") {
        version = "b1.2_02";
    }

    if (version == "13w03a-1538") {
        version = "13w02b"
    }
    
    console.log(`${current} -> ${version}`)
    
    if (!(await exists(`./diff/${current}#${version}.json`))) {
        console.log("Generating diff json...")
        const currentJson = await getVersionLang(current);

        const versionJson = await getVersionLang(version);

        const diff = compareJsons(currentJson, versionJson);

        await Deno.writeFile(`./diff/${current}#${version}.json`, encoder.encode(JSON.stringify(diff, undefined, 4)));

        console.log("Done")
    } else {
        console.log("Already Done")
    }

    versionFromVersion[version] = current;

    current = version;
}

const additionalDiffs: Record<string, string | string[]> = {
    "23w13a": "af-2023-1",
    "af-2023-1": "af-2023-2",

    "1.18.2": "af-2022",

    "1.18.1": "1.19_deep_dark_experimental_snapshot-1",

    "1.17.1-pre1": "1.17.1-pre2",
    "1.17.1-pre2": "1.17.1-pre3",
    "1.17.1-pre3": "1.17.1-rc1",
    "1.17.1-rc1": "1.17.1-rc2",
    "1.17.1-rc2": "1.17.1",

    "20w13b": "af-2020",

    "19w13b-1653": "af-2019",

    "1.9.2": "af-2016",

    "1.8.8": "1.8.9",

    "1.8.3": "af-2015",

    "1.7.4": "1.7.5",
    "1.7.5": "1.7.6-pre1",
    "1.7.6-pre1": "1.7.6-pre2",
    "1.7.6-pre2": "1.7.6",
    "1.7.6": "1.7.7-101331",
    "1.7.7-101331": "1.7.8",
    "1.7.8": "1.7.9",
    "1.7.9": "1.7.10-pre1",
    "1.7.10-pre1": "1.7.10-pre2",
    "1.7.10-pre2": "1.7.10-pre3",
    "1.7.10-pre3": "1.7.10-pre4",
    "1.7.10-pre4": "1.7.10",

    "1.6.2-091847": "1.6.3-pre-171231",
    "1.6.3-pre-171231": "1.6.4",

    "1.5.1": ["af-2013-red", "1.5.2-pre-250903"],
    "af-2013-red": "af-2013-purple",
    "af-2013-purple": "af-2013-blue",
    "1.5.2-pre-250903": "1.5.2",

    "1.3.1": "1.3.2"
}

for (const ver in additionalDiffs) {
    const val = additionalDiffs[ver];

    let targets: string[] = <string[]>val

    if (!Array.isArray(val)) {
        targets = [val]
    }

    for (let index = 0; index < targets.length; index++) {
        const targetVersion = targets[index];
        console.log(`${ver} -> ${targetVersion}`)
        
        if (!(await exists(`./diff/${ver}#${targetVersion}.json`))) {
            console.log("Generating diff json...")
            const currentJson = await getVersionLang(ver);

            const versionJson = await getVersionLang(targetVersion);

            const diff = compareJsons(currentJson, versionJson);
    
            await Deno.writeFile(`./diff/${ver}#${targetVersion}.json`, encoder.encode(JSON.stringify(diff, undefined, 4)));
    
            console.log("Done")
        } else {
            console.log("Already Done")
        }

        versionFromVersion[targetVersion] = ver;
    }
}

const diffInfoString = encoder.encode(JSON.stringify(versionFromVersion));
await Deno.writeFile("./diff_info.json", diffInfoString, {create: true});

console.log("DONE")
console.log("Fetching latest supported language list.");

const firstVersionManifest = await fetch(versionManifest["versions"][0]["url"]);
const firstVersionJson = await firstVersionManifest.json();
const firstAssetsManifest = await fetch(firstVersionJson["assetIndex"]["url"])
const firstAssetsJson = await firstAssetsManifest.json();
const mcMetaFile = await fetch(getResourceUrl(firstAssetsJson["objects"]["pack.mcmeta"]["hash"]));
await Deno.remove("./pack.mcmeta");
const mcMetaPath = await Deno.open(`./pack.mcmeta`, { write: true, create: true });
const mcMetaStream = writableStreamFromWriter(mcMetaPath);
await mcMetaFile.body?.pipeTo(mcMetaStream);

console.log("DONE");

const mcMetaString = decoder.decode(await Deno.readFile("./pack.mcmeta")).trim();
const mcMetaManifest = JSON.parse(mcMetaString)["language"];

console.log("Downloading original translation files.")

await Deno.remove("./translations_info.json");

const versionToAssets: Record<string, string> = {}

for (const i in versionManifest["versions"]) {
    const verId = versionManifest["versions"][i]["id"];
    const verType = versionManifest["versions"][i]["type"];
    if (verType != "old_beta" && verType != "old_alpha" && verType != "alpha_server" && verType != "classic_server") {
        const vMan = await fetch(versionManifest["versions"][i]["url"]);
        const vText = await vMan.text();
        
        if ((vText).startsWith("<")) continue;
        
        const vManifest = JSON.parse(vText);

        let aId = "pre-1.6"
        
        if (Object.hasOwn(vManifest, "assetIndex")) {
            aId = vManifest["assetIndex"]["id"];
        }
        
        if (aId != "pre-1.6") {
            const aHash = vManifest["assetIndex"]["sha1"];
            const aManifest = (await (await fetch(vManifest["assetIndex"]["url"])).json())["objects"];

            versionToAssets[verId] = aId + "/" + aHash;

            if (!(await exists(`./translated_original/${aId}`))) {
                await Deno.mkdir(`./translated_original/${aId}`)
            }

            if (!(await exists(`./translated_original/${aId}/${aHash}`))) {
                await Deno.mkdir(`./translated_original/${aId}/${aHash}`)
            } else {
                continue;
            }

            const fold = `./translated_original/${aId}/${aHash}/`;

            console.log("Downloading translation files into: " + fold);

            for (const langKey in mcMetaManifest) {
                if (Object.hasOwn(aManifest, `minecraft/lang/${langKey}.json`)) {
                    const lUrl = await fetch(getResourceUrl(aManifest[`minecraft/lang/${langKey}.json`]["hash"]));
                    const lPath = await Deno.open(fold + `${langKey}.json`, { write: true, create: true });
                    const lStream = writableStreamFromWriter(lPath);
                    await lUrl.body?.pipeTo(lStream);
                } else if (Object.hasOwn(aManifest, `minecraft/lang/${langKey}.lang`)) {
                    const lUrl = await fetch(getResourceUrl(aManifest[`minecraft/lang/${langKey}.lang`]["hash"]));
                    const lText = await lUrl.text();
                    const lJson = readLangFromString(lText, false);
                    await writeLangFile(fold + `${langKey}.json`, lJson, true);
                } else if (Object.hasOwn(aManifest, `minecraft/lang/${getUpperCaseCode(langKey)}.lang`)) {
                    const lUrl = await fetch(getResourceUrl(aManifest[`minecraft/lang/${getUpperCaseCode(langKey)}.lang`]["hash"]));
                    const lText = await lUrl.text();
                    const lJson = readLangFromString(lText, false);
                    await writeLangFile(fold + `${langKey}.json`, lJson, true);
                } else if (Object.hasOwn(aManifest, `lang/${getUpperCaseCode(langKey)}.lang`)) {
                    const lUrl = await fetch(getResourceUrl(aManifest[`lang/${getUpperCaseCode(langKey)}.lang`]["hash"]));
                    const lText = await lUrl.text();
                    const lJson = readLangFromString(lText, false);
                    await writeLangFile(fold + `${langKey}.json`, lJson, true);
                }
            }
        } else {
            const vId = versionManifest["versions"][i]["id"];

            if (noClient.includes(vId)) continue;

            versionToAssets[verId] = aId + "/" + vId;

            if (!(await exists(`./translated_original/${aId}`))) {
                await Deno.mkdir(`./translated_original/${aId}`)
            }

            if (!(await exists(`./translated_original/${aId}/${vId}`))) {
                await Deno.mkdir(`./translated_original/${aId}/${vId}`)
            } else {
                continue;
            }

            const fold = `./translated_original/${aId}/${vId}/`;

            console.log("Extracting translation files into: " + fold);

            if (await exists(`./jars/${vId}.jar`)) {
                await decompress(`./jars/${vId}.jar`, "./cache");
                
                for (const langKey in mcMetaManifest) {
                    if (await exists(`./cache/lang/${getUpperCaseCode(langKey)}.lang`)) {
                        const lJson = await readLangFromFile(`./cache/lang/${getUpperCaseCode(langKey)}.lang`, false);
                        await writeLangFile(fold + `${langKey}.json`, lJson, true);
                    }
                }
                
                await emptyDir("./cache");
            } else {
                console.log(`Unable to find jar file for version: ${vId}`)
            }
        }
    }
}

const infoString = encoder.encode(JSON.stringify(versionToAssets));
await Deno.writeFile("./translations_info.json", infoString, {create: true});

console.log("DONE");

function compareJsons(current: Record<string, string>, version: Record<string, string>) {
    const returnValue: Record<string, string[] | Record<string, string[]>> = {};

    const keyDisappeared = filterKeys(current,
        key => !Object.hasOwn(version, key),
    );

    returnValue.removed = Object.keys(keyDisappeared);

    const valueChanged = filterKeys(current,
        key => Object.hasOwn(version, key) && (version[key] != current[key]),
    );

    returnValue.changed = Object.keys(valueChanged);

    const keyAdded = filterKeys(version,
        key => !Object.hasOwn(current, key),
    );

    returnValue.added = Object.keys(keyAdded);

    const valueMoved: Record<string, string[]> = {}

    for (const i in returnValue.removed) {
        const key = returnValue.removed[i];
        const value = current[key];

        const possibleKeys = filterValues(version, val => value == val);

        if (Object.keys(possibleKeys).length > 0) {
            for (const k in possibleKeys) {
                if (returnValue.added.includes(k)) {
                    if (!Object.hasOwn(valueMoved, key)) {
                        valueMoved[key] = [];
                    }

                    valueMoved[key].push(k);
                }
            }
        }
    }

    returnValue.valueMoved = valueMoved;

    return returnValue;
}

async function getVersionLang(version:string) {
    if (await exists(`./original/${version}.json`)) {
        return await readLangFromFile(`./original/${version}.json`, true);
    }

    return {}
}

async function readLangFromFile(filePath:string, json:boolean) {
    const file = await Deno.readFile(filePath);
    return readLangFromString(decoder.decode(file), json);
}

function readLangFromString(content:string, json:boolean) {
    let fileString: Record<string, string> = {};
    
    if (json) {
        fileString = JSON.parse(content);
    } else {
        const lines = content.split("\n");

        for (const i in lines) {
            const line = lines[i];

            if (line.includes("=") && !line.startsWith("#")) {
                const parts = line.split("=");

                const key = parts[0];
                let value = "";

                for (let i = 1; i < parts.length; i++) {
                    value += (i != 1 ? "=" : "") + parts[i];
                }

                fileString[key] = value.trim();
            }
        }
    }

    return fileString;
}

async function writeLangFile(filePath:string, map:Record<string, string>, json:boolean) {
    if (json) {
        const data = encoder.encode(JSON.stringify(map));
        await Deno.writeFile(filePath, data, {create:true});
    } else {
        let langString = ""

        for (const key in map) {
            if (langString.length > 0) {
                langString += "\n" + key + "=" + map[key];
            } else {
                langString = key + "=" + map[key];
            }
        }

        const data = encoder.encode(langString);
        await Deno.writeFile(filePath, data, {create:true});
    }
}

function getResourceUrl(hash: string) {
    return `https://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`
}

function getUpperCaseCode(code: string) {
    let newCode = code;

    if (code.includes("_")) {
        const sp = code.split("_");
        newCode = sp[0] + "_" + sp[1].toLocaleUpperCase('en')
    }

    return newCode;
}