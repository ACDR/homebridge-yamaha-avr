
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# homebridge-yamaha-avr

`homebridge-yamaha-avr` is a Homebridge plugin allowing you to control your AVR & any connected HDMI-CEC controllable devices with the Apple Home app & Control Centre remote! It should work with all network accessible receivers.

The Yamaha AVR will display as an Audio Receiver with Power, Input, Volume & Remote Control.

## Requirements
* iOS 14 (or later)
* [Homebridge](https://homebridge.io/) v1.1.6 (or later)

## Installation
Install homebridge-yamaha-avr:
```sh
npm install -g homebridge-yamaha-avr
```

## Usage Notes
* Quickly switch input using the information (i) button in the Control Centre remote
* Adjust the volume using the physical volume buttons on your iOS device whilst the Control Centre remote is open

## Configuration
Add a new platform to your homebridge `config.json`.

Specific "favourite" inputs can be added manually or all available inputs reported by the AVR will be set.

Example configuration:

```js
{
    "platforms": [
      {
        "platform": "yamaha-avr",
        "name": "Yamaha RX-V685",
        "ip": "192.168.1.12",
        "inputs": [
          {
            "id": "AV1",
            "name": "LG TV"
          },
          {
            "id": "HDMI1",
            "name": "NVIDIA SHIELD"
          },
          {
            "id": "HDMI2",
            "name": "Apple TV"
          },
          {
            "id": "HDMI3",
            "name": "PC"
          },
          {
            "id": "HDMI4",
            "name": "Xbox One"
          },
          {
            "id": "HDMI5",
            "name": "PlayStation 4"
          },
          {
            "id": "Spotify",
            "name": "Spotify"
          },
          {
            "id": "AirPlay",
            "name": "AirPlay"
          }
        ]
      }
    ]
  }
```

## Other Yamaha Receiver Plugins
#### [homebridge-yamaha-zone-tv](https://github.com/NorthernMan54/homebridge-yamaha-zone-tv)
For multi-zone Yamaha Receivers, and uses the Television control for each zone of the receiver.

#### [homebridge-yamaha-home](https://github.com/NorthernMan54/homebridge-yamaha-home)
For multi-zone Yamaha Receivers, and uses a Fan to control each zone of the receiver.

# Contributing

## Build Plugin

TypeScript needs to be compiled into JavaScript before it can run. The following command will compile the contents of the [`src`](./src) directory and put the resulting code into the `dist` folder.

```
npm run build
```

## Link To Homebridge

Run this command so your global install of Homebridge can discover the plugin in your development environment:

```
npm link
```

You can now start Homebridge, use the `-D` flag so you can see debug log messages:

```
homebridge -D
```

## Watch For Changes and Build Automatically

If you want to have your code compile automatically as you make changes, and restart Homebridge automatically between changes you can run:

```
npm run watch
```

This will launch an instance of Homebridge in debug mode which will restart every time you make a change to the source code. It will load the config stored in the default location under `~/.homebridge`. You may need to stop other running instances of Homebridge while using this command to prevent conflicts. You can adjust the Homebridge startup command in the [`nodemon.json`](./nodemon.json) file.


