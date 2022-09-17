export interface BaseResponse {
  response_code: number;
}

export interface DeviceInfo {
  response_code: number;
  model_name: string;
  destination: string;
  device_id: string;
  system_id: string;
  system_version: number;
  api_version: number;
  netmodule_generation: number;
  netmodule_version: string;
  netmodule_checksum: string;
  serial_number: string;
  category_code: number;
  operation_mode: string;
  update_error_code: string;
  net_module_num: number;
  update_data_type: number;
}

export interface Features {
  response_code: number;
  system: {
    zone_num: number;
  };
  zone: FeatureZone[];
}

export interface FeatureZone {
  id: Zone['id'];
  input_list: Input['id'][];
}

export interface ZoneStatus {
  response_code: number;
  power: 'on' | 'standby';
  sleep: number;
  volume: number;
  mute: boolean;
  max_volume: number;
  input: Input['id'];
  input_text: Input['name'];
  distribution_enable: boolean;
  sound_program: SoundProgram['id'];
  surr_decoder_type: string;
  pure_direct: boolean;
  enhancer: boolean;
  tone_control: {
    mode: string;
    bass: number;
    treble: number;
  };
  dialogue_level: number;
  dialogue_lift: number;
  subwoofer_volume: number;
  link_control: string;
  link_audio_delay: string;
  disable_flags: number;
  contents_display: boolean;
  actual_volume: {
    mode: string;
    value: number;
    unit: string;
  };
  party_enable: boolean;
  extra_bass: boolean;
  adaptive_drc: boolean;
  dts_dialogue_control: number;
  adaptive_dsp_level: boolean;
}

export interface Zone {
  id: 'main' | 'zone2' | 'zone3' | 'zone4';
  text: string;
}

export interface Input {
  avrId: string;
  id: string;
  name: string;
}

export interface SoundProgram {
  id:
    | 'munich_a'
    | 'munich_b'
    | 'munich'
    | 'frankfurt'
    | 'stuttgart'
    | 'vienna'
    | 'amsterdam'
    | 'usa_a'
    | 'usa_b /tokyo'
    | 'freiburg'
    | 'royaumont'
    | 'chamber'
    | 'concert'
    | 'village_gate'
    | 'village_vanguard /warehouse_loft'
    | 'cellar_club'
    | 'jazz_club'
    | 'roxy_theatre'
    | 'bottom_line'
    | 'arena'
    | 'sports /action_game'
    | 'roleplaying_game'
    | 'game'
    | 'music_video'
    | 'music'
    | 'recital_opera'
    | 'pavilion /disco'
    | 'standard'
    | 'spectacle'
    | 'sci-fi'
    | 'adventure'
    | 'drama'
    | 'talk_show'
    | 'tv_program /mono_movie'
    | 'movie'
    | 'enhanced'
    | '2ch_stereo'
    | '5ch_stereo'
    | '7ch_stereo'
    | '9ch_stereo /11ch_stereo'
    | 'stereo'
    | 'surr_decoder'
    | 'my_surround'
    | 'target'
    | 'straight'
    | 'off';
  text: string;
}

export interface NameText {
  response_code: number;
  zone_list: Zone[];
  input_list: Input[];
  sound_program_list: SoundProgram[];
}

export interface AccessoryContext {
  device: {
    displayName: string;
    modelName: DeviceInfo['model_name'];
    systemId: DeviceInfo['system_id'];
    firmwareVersion: DeviceInfo['system_version'];
    baseApiUrl: string;
  };
}

export type Cursor = 'Up' | 'Down' | 'Left' | 'Right' | 'Sel' | 'Return';

export enum MainZoneRemoteCode {
  // numeric codes
  NUM_1 = '7F0151AE',
  NUM_2 = '7F0152AD',
  NUM_3 = '7F0153AC',
  NUM_4 = '7F0154AB',
  NUM_5 = '7F0155AA',
  NUM_6 = '7F0156A9',
  NUM_7 = '7F0157A8',
  NUM_8 = '7F0158A7',
  NUM_9 = '7F0159A6',
  NUM_0 = '7F015AA5',
  NUM_10_PLUS = '7F015BA4',
  ENT = '7F015CA3',

  // operations codes
  PLAY = '7F016897',
  STOP = '7F016996',
  PAUSE = '7F016798',
  SEARCH_BACK = '7F016A95',
  SEARCH_FWD = '7F016B94',
  SKIP_BACK = '7F016C93',
  SKIP_FWD = '7F016D92',
  INPUT_BACK = '7A85235C',
  INPUT_FWD = '7A851F60',
  FM = '7F015827',
  AM = '7F01552A',

  // cursor codes
  UP = '7A859D62',
  DOWN = '7A859C63',
  LEFT = '7A859F60',
  RIGHT = '7A859E61',
  ENTER = '7A85DE21',
  RETURN = '7A85AA55',
  LEVEL = '7A858679',
  ON_SCREEN = '7A85847B',
  OPTION = '7A856B14',
  TOP_MENU = '7A85A0DF',
  POP_UP_MENU = '7A85A4DB',
}

export enum Zone2RemoteCode {
  // numeric codes
  NUM_1 = '7F01718F',
  NUM_2 = '7F01728C',
  NUM_3 = '7F01738D',
  NUM_4 = '7F01748A',
  NUM_5 = '7F01758B',
  NUM_6 = '7F017688',
  NUM_7 = '7F017789',
  NUM_8 = '7F017886',
  NUM_9 = '7F017986',
  NUM_0 = '7F017A84',
  NUM_10_PLUS = '7F017B85',
  ENT = '7F017C82',

  // operations codes
  PLAY = '7F018876',
  STOP = '7F018977',
  PAUSE = '7F018779',
  SEARCH_BACK = '7F018A74',
  SEARCH_FWD = '7F018B75',
  SKIP_BACK = '7F018C72',
  SKIP_FWD = '7F018D73',
  FM = '7F015927',
  AM = '7F015628',

  // cursor codes
  UP = '7A852B55',
  DOWN = '7A852C52',
  LEFT = '7A852D53',
  RIGHT = '7A852E50',
  ENTER = '7A852F51',
  RETURN = '7A853C42',
  OPTION = '7A856C12',
  TOP_MENU = '7A85A1DF',
  POP_UP_MENU = '7A85A5DB',
}
export interface YamahaAPI {
  getBasicInfo: () => Promise<{
    isOn: () => boolean;
    getVolume: () => number;
    getCurrentInput: () => string;
  }>;
  getSystemConfig: () => Promise<{
    YAMAHA_AV: {
      System: {
        Config: {
          Model_Name: string[];
          System_ID: string[];
          Version: string[];
          Feature_Existence: {
            [key: string]: string[];
          }[];
          Name: {
            Input: string[];
          };
        }[];
      }[];
    };
  }>;
  getAvailableFeatures: () => Promise<string[]>;
  getAvailableInputsWithNames: () => Promise<
    {
      id: string;
      name: string;
    }[][]
  >;
  isOn: () => Promise<boolean>;
  powerOn: () => Promise<string>;
  powerOff: () => Promise<string>;
  volumeUp: (number) => Promise<string>;
  volumeDown: (number) => Promise<string>;
  setInputTo: (string) => Promise<string>;
  rewind: () => Promise<string>;
  skip: () => Promise<string>;
  pause: () => Promise<string>;
  play: () => Promise<string>;
  remoteCursor: (Cursor) => Promise<string>;
  catchRequestErrors: boolean;
}
