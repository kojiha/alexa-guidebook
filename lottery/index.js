'use strict';

// Alexa Skills Kit SDK を読み込む
const Alexa = require('ask-sdk-core');

// PersistentAdapter を読み込む
const { DynamoDbPersistenceAdapter } = require('ask-sdk-dynamodb-persistence-adapter');
const dynamoDbPersistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName: 'LotteryTable'
});


// 状態管理用の定数
const STATE_NONE = 'NONE';      // 初期状態
const STATE_REPEAT = 'REPEAT';  // 当選者の読み上げ中

// スキルの名称
const SKILL_NAME = '抽選スキル';
// 当選者の再読み上げを受け付ける時間 [ms]
const REPEAT_THRESHOLD = 60000;
// 参加者
var initialApplicants = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];


// ランダムな整数 n (min <= n < max) を返す
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

// 永続アトリビュートを取得する
function getAttributes(attributesManager) {
  return new Promise((resolve, reject) => {
    attributesManager.getPersistentAttributes()
      .then((attributes) => {
        if (attributes.validApplicants == undefined) {
          attributes.validApplicants = initialApplicants;
        }
        resolve(attributes);
      })
      .catch((error) => {
        resolve({ validApplicants: initialApplicants });
      });
  });
}

// 状態をセットする
function setLastState(attributes, state) {
  let stateDate = new Date();
  attributes.lastState = {
    state: state,
    timestamp: stateDate.getTime()
  };
}

function clearLastState(attributes) {
  attributes.lastState = {
    state: STATE_NONE,
    timestamp: 0
  };
}

// 当選者を決定して履歴に追加する
function doDrawLots(attributes, winnerCount) {
  // 当選者を決定する
  let winners = [];
  let validApplicants = attributes.validApplicants;
  for (let i = 0; i < winnerCount; ++i) {
      let index = getRandomInt(0, validApplicants.length);
      winners.push(validApplicants[index]);
      validApplicants.splice(index, 1);
  }
  console.log("winners:", JSON.stringify(winners, null, 2));

  // 当選者履歴に追加する
  let winnerHistory = attributes.winnerHistory;
  if (winnerHistory == undefined) {
      winnerHistory = [];
  }
  let date = new Date();
  winnerHistory.push({ timestamp: date.getTime(), winners: winners });
  console.log("winnerHistory", JSON.stringify(winnerHistory, null, 2));
  attributes.winnerHistory = winnerHistory;
}

// 最後の当選者を取得する
function getLastWinners(attributes) {
  return attributes.winnerHistory[attributes.winnerHistory.length - 1];
}

// 当選者読み上げの文言を生成する
function getWinnersSpeech(winners) {
  const winnersString = winners.join('<break time="1s"/>,');
  const winnersSpeechSingle = '<prosody volume="x-loud">当選者は、<break time="1s"/>' + winnersString + '<break time="1s"/>です。</prosody>';
  return winnersSpeechSingle + '<break time="1s"/>繰り返します。' + winnersSpeechSingle;
}

// 抽選を行う
function drawLots(handlerInput, attributes) {
  console.log(`dialogState: ${handlerInput.requestEnvelope.request.dialogState}`);
  if (handlerInput.requestEnvelope.request.dialogState !== 'COMPLETED') {
    // 不足している情報を収集する
    return handlerInput.responseBuilder
      .addDelegateDirective()
      .getResponse();
  }

  // スロットの値を取得する
  let winnerCount = Number(handlerInput.requestEnvelope.request.intent.slots.winnerCount.value);
  console.log(`winnerCount: ${winnerCount}`);
  if (isNaN(winnerCount) || winnerCount < 1) {
      // 当選者数を再度確認する
      const repromptSpeech = '当選者数は何件にしますか？';
      return handlerInput.responseBuilder
        .addElicitSlotDirective('winnerCount')
        .speak(repromptSpeech)
        .reprompt(repromptSpeech)
        .getResponse();
  }

    // 当選者を決定して履歴に追加する
    doDrawLots(attributes, winnerCount);
    // 状態をセットする
    setLastState(attributes, STATE_REPEAT);
    // 永続アトリビュートを保存する
    handlerInput.attributesManager.setPersistentAttributes(attributes);
    return handlerInput.attributesManager.savePersistentAttributes()
      .then(() => {
        // 結果を生成して返答する
        const lastWinners = getLastWinners(attributes)
        console.log("lastWinners:", JSON.stringify(lastWinners, null, 2));
        const winners = lastWinners.winners;
        const winnersSpeech = getWinnersSpeech(winners);
        const cardString = '当選者: ' + winners.join(',');
        const repromptSpeech = 'もう一度当選者を読み上げますか？';
        const speechOutput = 
            '抽選しています。<break time="3s"/>' +
            '抽選が終わりました。当選者を発表します。' +
            winnersSpeech +
            repromptSpeech;

        return handlerInput.responseBuilder
        .speak(speechOutput)
        .withSimpleCard(SKILL_NAME, cardString)
        .reprompt(repromptSpeech)
        .getResponse();
      });
}


// LaunchRequest ハンドラー
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    // 永続アトリビュートを取得する
    return getAttributes(handlerInput.attributesManager)
      .then((attributes) => {
        // 抽選の対象者数を取得する
        let applicantCount = attributes.validApplicants.length;
        console.log(`applicantCount: ${applicantCount}`);

        return handlerInput.responseBuilder
          .speak(`対象者は ${applicantCount} 名です。抽選を始めますか？`)
          .reprompt('抽選を始めますか？')
          .getResponse();      
      })
  }
};

// DrawLotsIntent ハンドラー
const DrawLotsIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'DrawLotsIntent';
  },
  handle(handlerInput) {
    return getAttributes(handlerInput.attributesManager)
      .then((attributes) => {
        // 状態を判別する
        let nowDate = new Date();
        let now = nowDate.getTime();
        if (attributes.lastState !== undefined &&
            attributes.lastState.state == STATE_REPEAT &&
            now - attributes.lastState.timestamp <= REPEAT_THRESHOLD &&
            attributes.winnerHistory !== undefined) {
            let lastState = attributes.lastState;
            console.log("lastState:", JSON.stringify(lastState, null, 2));
            let lastWinners = getLastWinners(attributes);
            console.log("lastWinners:", JSON.stringify(lastWinners, null, 2));

            // 最後の当選者を読み上げる
            let winners = lastWinners.winners;
            const winnersSpeech = getWinnersSpeech(winners);
            const repromptSpeech = 'もう一度当選者を読み上げますか？';

            // 状態をセットする
            setLastState(attributes, STATE_REPEAT);
            // 永続アトリビュートを保存する
            handlerInput.attributesManager.setPersistentAttributes(attributes);
            return handlerInput.attributesManager.savePersistentAttributes()
              .then(() => {
                return handlerInput.responseBuilder
                .speak(winnersSpeech)
                .reprompt(repromptSpeech)
                .getResponse();
              });
        } else {
          // 抽選を行う
          return drawLots(handlerInput, attributes);
        }
      })
  }
};

// NoIntent ハンドラー
const NoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent';
  },
  handle(handlerInput) {
    // 状態をクリアする
    clearLastState(attributes);
    // 永続アトリビュートを保存する
    handlerInput.attributesManager.setPersistentAttributes(attributes);
    return handlerInput.attributesManager.savePersistentAttributes()
      .then(() => {
        return handlerInput.responseBuilder
          .getResponse();
      });
  },
};

// HelpIntent ハンドラー
const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(`${SKILL_NAME} です。抽選を始めますか？`)
      .reprompt('抽選を始めますか？')
      .getResponse();
  },
};

// CancelIntent, StopIntent ハンドラー
const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('終了します')
      .getResponse();
  },
};

// SessionEndedRequest ハンドラー
const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

// エラーハンドラー
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);

    return handlerInput.responseBuilder
      .speak('うまく聞き取れませんでした。')
      .reprompt('もういちどお願いします。')
      .getResponse();
  },
};

// (4) Lambda 関数ハンドラーを定義する
const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .withPersistenceAdapter(dynamoDbPersistenceAdapter)
  .addRequestHandlers(
    LaunchRequestHandler,
    DrawLotsIntentHandler,
    NoIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
