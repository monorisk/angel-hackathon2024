import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, Platform, StyleSheet, Text, View, Button, ImageBackground} from 'react-native';
import _ from "lodash";
import WebView from "react-native-webview";
import styled from 'styled-components/native';
import AsyncStorage from "@react-native-async-storage/async-storage";
import {SafeAreaView} from "react-native-safe-area-context";
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import axios from "axios";
import * as Notifications from "expo-notifications";

const KEY_USER_ID = 'userId';
const KEY_LOCATION = 'location';
const KEY_COLLECT_ID = 'collectId'

const LOCATION_TASK_NAME = 'background-location-task';

// local
// const DOMAIN = "http://172.18.6.253:8080"

// dev
const DOMAIN = "http://175.106.98.14:8080"

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false
    })
});

const StyledInput = styled.TextInput.attrs(({theme}) => ({
    placeholderTextColor: theme.main,
}))`
    width: ${({width}) => width - 40}px;
    height: 60px;
    margin: 3px 0;
    padding: 15px 20px;
    border-radius: 10px;
    background-color: chartreuse;
    font-size: 25px;
    color: ${({theme}) => theme.text};
`;

const sendLocation = async (location, background) => {
    await AsyncStorage.setItem(KEY_LOCATION, JSON.stringify(location));

    const userId = await AsyncStorage.getItem(KEY_USER_ID);
    if (!userId) {
        console.log("sendLocation noUserId");
        return;
    }

    const rawCollectId = await AsyncStorage.getItem(KEY_COLLECT_ID);
    if (_.isEmpty(rawCollectId)) {
        console.log("sendLocation no collectId");
        return;
    }

    const collectId = Number(rawCollectId)

    const refinedLocation = {
        userId: userId,
        collectId: collectId,
        location: {
            lat: location?.coords?.latitude,
            lng: location?.coords?.longitude
        }
    }

    console.log(`sendLocation. refinedLocation: ${JSON.stringify(refinedLocation)}`);

    axios.post(`${DOMAIN}/api/v1/user-collecting`, refinedLocation);
}

export default function App() {
    const [userId, setUserId] = useState('')
    const [inputUserId, setInputUserId] = useState('')

    const webViewRef = useRef(null);

    const _initUserId = async () => {
        const currentUserId = await AsyncStorage.getItem(KEY_USER_ID);
        setUserId(currentUserId);
    }

    const _saveUserId = async (userId) => {
        try {
            await AsyncStorage.setItem(KEY_USER_ID, userId);
            setUserId(inputUserId);
        } catch (e) {
            alert(`Failed to save userId. ${JSON.stringify(e)}`);
        }
    }

    const _bindUserId = () => {
        _saveUserId(inputUserId);
    }

    const _onAndroidBackPress = () => {
        if (webViewRef.current) {
            webViewRef.current.goBack();
            return true;
        }

        return false;
    }

    const _webViewEventHandler = async event => {
        console.log(`_webViewEventHandler event: ${JSON.stringify(event)}`);
        if (!event.nativeEvent.data) {
            console.log(`_webViewEventHandler no data`);
            return;
        }

        const parsedEvent = JSON.parse(event.nativeEvent.data);
        if (parsedEvent?.type === 'coordinate') {
            console.log(`_webViewEventHandler coordinate request`)
            const rawLocation = await AsyncStorage.getItem(KEY_LOCATION);

            const location = JSON.parse(rawLocation);
            const response = {
                type: 'coordinate',
                payload: {
                    location: {
                        lat: location?.coords?.latitude,
                        lng: location?.coords?.longitude
                    }
                }
            };

            console.log(`_webViewEventHandler coordinate response: ${JSON.stringify(response)}`)
            webViewRef.current.postMessage(JSON.stringify(response));
            return;
        }

        if (parsedEvent?.type === 'startCollect') {
            const collectId = parsedEvent.payload.id;
            console.log(`_webViewEventHandler startCollect request: ${parsedEvent.payload.id}`)
            await AsyncStorage.setItem(KEY_COLLECT_ID, JSON.stringify(collectId))
            return;
        }

        if (parsedEvent?.type === 'stopCollect') {
            console.log(`_webViewEventHandler stopCollect request`)
            await AsyncStorage.setItem(KEY_COLLECT_ID, '')
            return;
        }

        console.log(`Unknown event: ${JSON.stringify(event.data)}`);
    }

    const _requestPermissions = async () => {
        console.info("requestPermissions called")

        const {status: foregroundStatus} = await Location.requestForegroundPermissionsAsync();
        console.info(`foregroundStatus: ${foregroundStatus}`)

        if (foregroundStatus === 'granted') {
            const {status: backgroundStatus} = await Location.requestBackgroundPermissionsAsync();
            if (backgroundStatus === 'granted') {
                console.info(`backgroundStatus: ${backgroundStatus}`)

                await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
                    accuracy: Location.Accuracy.BestForNavigation,
                    deferredUpdatesInterval: 10000
                });

                console.info("requestPermissions done")
            }

            await Location.watchPositionAsync({
                accuracy: Location.Accuracy.BestForNavigation,
                deferredUpdatesInterval: 10000
            }, (location) => {
                sendLocation(location, false);
            });
        }
    };

    useEffect(() => {
        _initUserId();
        _requestPermissions();

        if (Platform.OS === 'android') {
            BackHandler.addEventListener('hardwareBackPress', _onAndroidBackPress);

            return () => {
                BackHandler.removeEventListener('hardwareBackPress', _onAndroidBackPress);
            };
        }
    }, []);

    return (_.isEmpty(userId) ?
            (<SafeAreaView style={styles.container}>
                <StyledInput
                    placeholder='ID입력'
                    onChangeText={(text) => setInputUserId(text)}
                    onSubmitEditing={_bindUserId}
                />
            </SafeAreaView>) :
            (<SafeAreaView style={{flex: 1}}>
                <WebView source={{
                    uri: `${DOMAIN}?userId=${userId}`
                }}
                         ref={webViewRef}
                         mixedContentMode='compatibility'
                         originWhitelist={['*']}
                         allowsBackForwardNavigationGestures={true}
                         sharedCookiesEnabled={true}
                         onMessage={(event) => {
                             console.log(`onMessage: ${JSON.stringify(event)}`);
                             _webViewEventHandler(event)
                         }}
                         startInLoadingState={true}
                         webviewDebuggingEnabled={true}
                />
            </SafeAreaView>)
    );
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({data, error}) => {
    console.log(`${LOCATION_TASK_NAME} event. ${JSON.stringify(data)}`)

    if (error) {
        console.error(`${LOCATION_TASK_NAME} error: ${JSON.stringify(error)}`);
        return;
    }

    if (data) {
        await AsyncStorage.setItem(KEY_LOCATION, JSON.stringify(data));
        sendLocation(location, true);
    } else {
        console.error(`${LOCATION_TASK_NAME} error: ${JSON.stringify(error)}`);
    }
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    image: {
        flex: 1,
        resizeMode: 'cover',
        justifyContent: 'center',
    }
});