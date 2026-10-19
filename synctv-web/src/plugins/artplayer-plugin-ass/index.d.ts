import type Artplayer from "artplayer"
import type SubtitlesOctopus from "libass-wasm"
import { type Options } from "libass-wasm"

export = artplayerPluginAss
export as namespace artplayerPluginAss
type Ass = {
  name: "artplayerPluginAss"
  instance: SubtitlesOctopus | null
}

declare const artplayerPluginAss: (options: Partial<Options>) => (art: Artplayer) => Ass
