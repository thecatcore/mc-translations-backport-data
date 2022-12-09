import { writableStreamFromWriter } from "https://deno.land/std@0.155.0/streams/mod.ts";
import * as fs from "https://deno.land/std@0.155.0/fs/mod.ts";
import * as zip from "https://deno.land/x/zip@v1.2.3/mod.ts";
import { filterKeys, filterValues } from "https://deno.land/std@0.155.0/collections/mod.ts";

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

const versionDetails = "https://skyrising.github.io/mc-versions/version/{}.json";

const versionListFile = await fetch("https://skyrising.github.io/mc-versions/version_manifest.json");
const versionManifest = await versionListFile.json();

console.log("Downloading mc jars...");

if (!(await fs.exists("./jars"))) {
    await Deno.mkdir("./jars")
}

if (!(await fs.exists("./original"))) {
    await Deno.mkdir("./original")
}

if (!(await fs.exists("./translated_original"))) {
    await Deno.mkdir("./translated_original")
}

if (!(await fs.exists("./diff"))) {
    await Deno.mkdir("./diff")
}

if (!(await fs.exists("./translated"))) {
    await Deno.mkdir("./translated")
}

for (const i in versionManifest["versions"]) {
    const id: string = versionManifest["versions"][i]["omniId"];
    const type: string = versionManifest["versions"][i]["type"];

    if (await fs.exists(`./original/${id}.json`)) continue;

    if (!await fs.exists(`./jars/${id}.jar`)) {
        try {
            const versionInfo = await (await fetch(versionDetails.replace("{}", id))).json();

            if (versionInfo["downloads"]["client"] && type != "old_alpha") {
                const jarFile = await fetch(versionInfo["downloads"]["client"]["url"])

                if (jarFile.body) {
                    const jarPath = await Deno.open(`./jars/${id}.jar`, { write: true, create: true });

                    const writableStream = writableStreamFromWriter(jarPath);
                    await jarFile.body.pipeTo(writableStream);

                    console.log(id);
                }
            }
        } catch (e) {
            if (await fs.exists(`./original/${id}.json`)) continue;

            throw e;
        }
    }
}

console.log("DONE");

await fs.emptyDir("./cache")

console.log("Extracting lang file...")

for await (const dirEntry of Deno.readDir("./jars")) {
    const name = dirEntry.name;

    const version = name.replace(".jar", "");

    if (await fs.exists(`./original/${version}.json`)) continue;

    await zip.decompress(`./jars/${name}`, "./cache");

    if (await fs.exists(`./cache/assets/minecraft/lang/en_us.json`)) {
        await fs.move(`./cache/assets/minecraft/lang/en_us.json`, `./original/${version}.json`);
    } else if (await fs.exists(`./cache/assets/minecraft/lang/en_us.lang`)) {
        const data = await readLangFromFile(`./cache/assets/minecraft/lang/en_us.lang`, false);
        await writeLangFile(`./original/${version}.json`, data, true);
    } else if (await fs.exists(`./cache/assets/minecraft/lang/en_US.lang`)) {
        const data = await readLangFromFile(`./cache/assets/minecraft/lang/en_US.lang`, false);
        await writeLangFile(`./original/${version}.json`, data, true);
    } else if (await fs.exists(`./cache/lang/en_US.lang`)) {
        const data = await readLangFromFile(`./cache/lang/en_US.lang`, false);

        if (await fs.exists(`./cache/lang/stats_US.lang`)) {
            const data2 = await readLangFromFile(`./cache/lang/stats_US.lang`, false);

            for (const key in data2) {
                data[key] = data2[key];
            }
        }

        await writeLangFile(`./original/${version}.json`, data, true);
    }

    await fs.emptyDir("./cache");
}

console.log("DONE")

console.log("Generating diff between lang files...")

let current = versionManifest["versions"][0]["omniId"];

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
    
    console.log(`${current} -> ${version}`)
    
    if (!(await fs.exists(`./diff/${current}#${version}.json`))) {
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
    if (versionManifest["versions"][i]["type"] != "old_beta" && versionManifest["versions"][i]["type"] != "old_alpha") {
        const vMan = await fetch(versionManifest["versions"][i]["url"]);
        const vText = await vMan.text();
        
        if ((vText).startsWith("<")) continue;
        
        const vManifest = JSON.parse(vText);
        
        if (!Object.hasOwn(vManifest, "assetIndex")) continue;
        
        const aId = vManifest["assetIndex"]["id"];
        
        if (aId != "pre-1.6") {
            const aHash = vManifest["assetIndex"]["sha1"];
            const aManifest = (await (await fetch(vManifest["assetIndex"]["url"])).json())["objects"];

            versionToAssets[verId] = aId + "/" + aHash;

            if (!(await fs.exists(`./translated_original/${aId}`))) {
                await Deno.mkdir(`./translated_original/${aId}`)
            }

            if (!(await fs.exists(`./translated_original/${aId}/${aHash}`))) {
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
            const vId = versionManifest["versions"][i]["omniId"];

            versionToAssets[verId] = aId + "/" + vId;

            if (!(await fs.exists(`./translated_original/${aId}`))) {
                await Deno.mkdir(`./translated_original/${aId}`)
            }

            if (!(await fs.exists(`./translated_original/${aId}/${vId}`))) {
                await Deno.mkdir(`./translated_original/${aId}/${vId}`)
            } else {
                continue;
            }

            const fold = `./translated_original/${aId}/${vId}/`;

            console.log("Extracting translation files into: " + fold);

            await zip.decompress(`./jars/${vId}.jar`, "./cache");
            
            for (const langKey in mcMetaManifest) {
                if (await fs.exists(`./cache/lang/${getUpperCaseCode(langKey)}.lang`)) {
                    const lJson = await readLangFromFile(`./cache/lang/${getUpperCaseCode(langKey)}.lang`, false);
                    await writeLangFile(fold + `${langKey}.json`, lJson, true);
                }
            }
            
            await fs.emptyDir("./cache");
        }
    }
}

const infoString = encoder.encode(JSON.stringify(versionToAssets));
await Deno.writeFile("./translations_info.json", infoString, {create: true});

console.log("DONE");

// await fs.emptyDir("./translated");

// type DiffMap = Record<string, Array<string>>;
// type DiffFile = {
//     removed: string[],
//     changed: string[],
//     added: string[],
//     valueMoved: Record<string, string[]>
// };

// const diffMap: DiffMap = {}

// for await (const dirEntry of Deno.readDir("./diff")) {
//     const entry = dirEntry.name.replace(".json", "").split("#");

//     if (!Object.hasOwn(diffMap, entry[0])) {
//         diffMap[entry[0]] = []
//     }

//     diffMap[entry[0]].push(entry[1]);
// }

// console.log("DONE")

// const todoMap: Array<{
//     parent: string,
//     child: string
// }> = [
//     {
//         parent: "",
//         child: firstVersionJson["id"]
//     }
// ]

// while (todoMap.length > 0) {
//     const entry = todoMap.shift();

//     assert(entry != undefined, "ohno");

//     if (!(await fs.exists("./translated/" + entry.child))) {
//         await Deno.mkdir("./translated/" + entry.child);
//     }

//     if (!entry.parent) {
//         console.log("latest == " + entry.child);
        
//         for (const langKey in mcMetaManifest) {
//             const langPath = "./translated_original/" + versionToAssets[entry.child] + "/" + langKey + ".json";
//             const newLangPath = "./translated/" + entry.child + "/" + langKey + ".json";

//             if (await fs.exists(langPath)) {
//                 await Deno.writeFile(newLangPath, await Deno.readFile(langPath));
//             }
//         }
//     } else {
//         console.log(entry.parent + " -> " + entry.child);

//         const diffManifest: DiffFile = <DiffFile><unknown>JSON.parse(decoder.decode(await Deno.readFile("./diff/" + entry.parent + "#" + entry.child + ".json")));

//         for (const langKey in mcMetaManifest) {
//             if (langKey == "en_us") continue;

//             const newerLangJSON = <Record<string, string>><unknown>JSON.parse(decoder.decode(await Deno.readFile("./translated/" + entry.parent + "/" + langKey + ".json")));
//             const langPath = "./translated_original/" + versionToAssets[entry.child] + "/" + langKey + ".json";
//             const newLangPath = "./translated/" + entry.child + "/" + langKey + ".json";

//             let langPathJSON: Record<string, string>;

//             if (await fs.exists(langPath)) {
//                 langPathJSON = <Record<string, string>><unknown>JSON.parse(decoder.decode(await Deno.readFile(langPath)));
//             } else {
//                 langPathJSON = <Record<string, string>><unknown>JSON.parse(decoder.decode(await Deno.readFile("./original/" + entry.child + ".json")));
//             }

//             const theJson: Record<string, string> = {};

//             // Move
//             for (const key in diffManifest.valueMoved) {
//                 const newKeys = diffManifest.valueMoved[key];

//                 newKeys.forEach(newKey => {
//                     theJson[newKey] = newerLangJSON[key];
//                 });
//             }

//             // Add
//             diffManifest.added.forEach(key => {
//                 if (!Object.hasOwn(theJson, key)) {
//                     theJson[key] = langPathJSON[key];
//                 }
//             });

//             // Change
//             diffManifest.changed.forEach(key => {
//                 if (!Object.hasOwn(theJson, key)) {
//                     theJson[key] = langPathJSON[key];
//                 }
//             });

//             // Remove
//             for (const key in newerLangJSON) {
//                 const val = newerLangJSON[key];

//                 if (diffManifest.removed.includes(key) || Object.hasOwn(theJson, key)) continue;

//                 theJson[key] = val;
//             }

//             const theJASON = JSON.stringify(theJson, undefined, 4);
//             await Deno.writeFile(newLangPath, encoder.encode(theJASON));
//         }
//     }

//     if (Object.hasOwn(diffMap, entry.child)) {
//         diffMap[entry.child].forEach((mapValues, _indexOfNeedle, _arr) => {
//             todoMap.push({
//                 parent: entry.child,
//                 child: mapValues
//             });
//         })
//     }
// }

// console.log("DONE")

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
    if (await fs.exists(`./original/${version}.json`)) {
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