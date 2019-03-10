# homebridge-yamaha-avr

`homebridge-yamaha-avr` is a Homebridge plugin allowing you to control your AVR & any connected HDMI-CEC controllable devices with the Apple Home app & Control Centre remote! It should work with all network accessible receivers.

The Yamaha AVR will display as a TV Accessory with Power, Input, Volume & Remote Control.

## Requirements
* iOS 12.2 (beta)
* [Homebridge](https://homebridge.io/)

## Installation
Install homebridge-yamaha-avr:
```sh
npm install -g homebridge-yamaha-avr
```

## Usage Notes
Quickly switch input using the information (i) button in the Control Centre remote

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
          }
        ]
      }
    ]
  }
```
