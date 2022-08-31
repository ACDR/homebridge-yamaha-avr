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

export interface ZoneStatus {
  response_code: number;
  power: 'on' | 'standby';
  sleep: number;
  volume: number;
  mute: boolean;
  max_volume: number;
  input: Input['id'];
  input_text: Input['text'];
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
  id:
    | 'cd'
    | 'tuner'
    | 'multi_ch'
    | 'phono'
    | 'hdmi1'
    | 'hdmi2'
    | 'hdmi3'
    | 'hdmi4'
    | 'hdmi5'
    | 'hdmi6'
    | 'hdmi7'
    | 'hdmi8'
    | 'hdmi'
    | 'av1'
    | 'av2'
    | 'av3'
    | 'av4'
    | 'av5'
    | 'av6'
    | 'av7'
    | 'v_aux'
    | 'aux1'
    | 'aux2'
    | 'aux'
    | 'audio1'
    | 'audio2'
    | 'audio3'
    | 'audio4'
    | 'audio_cd'
    | 'audio'
    | 'optical1'
    | 'optical2'
    | 'optical'
    | 'coaxial1'
    | 'coaxial2'
    | 'coaxial'
    | 'digital1'
    | 'digital2'
    | 'digital'
    | 'line1'
    | 'line2'
    | 'line3'
    | 'line_cd'
    | 'analog'
    | 'tv'
    | 'bd_dvd'
    | 'usb_dac'
    | 'usb'
    | 'bluetooth'
    | 'server'
    | 'net_radio'
    | 'rhapsody'
    | 'napster'
    | 'pandora'
    | 'siriusxm'
    | 'spotify'
    | 'juke'
    | 'airplay'
    | 'radiko'
    | 'qobuz'
    | 'mc_link'
    | 'main_sync'
    | 'none';
  text: string;
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
    uuid: string;
    displayName: string;
    modelName: DeviceInfo['model_name'];
    systemId: DeviceInfo['system_id'];
    firmwareVersion: DeviceInfo['system_version'];
    baseApiUrl: string;
  };
}
