/**
 * Re-export from electron/channel-registry.ts for frontend use.
 * The canonical source lives in electron/ so it can be compiled by tsconfig.electron.json.
 */
export {
  type ConfigField,
  type ChannelDef,
  type CatalogEntry,
  getAllChannels,
  getBuiltinChannels,
  getChannel,
  getChannelByOpenclawId,
  toOpenclawId,
  toFrontendId,
  isOneClick,
  hasBrandIcon,
  buildCLIFlags,
  serializeRegistry,
  mergeCatalog,
  mergeChannelOptions,
  loadFromSerialized,
} from '../../electron/channel-registry';
