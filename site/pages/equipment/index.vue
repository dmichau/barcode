<template>
  <v-container fluid>
    <h2 class="error--text">
      This is not the real list yet
    </h2>
    <!-- --------------------------------------------------------------------------- -->
    <!-- A row for the dialogs -->
    <!-- --------------------------------------------------------------------------- -->
    <v-row>
      <!-- A dialog to get in line -->
      <v-dialog
        v-if="selectedItem"
        v-model="showGetInLineDialog"
        max-width="375px"
        persistent
      >
        <v-card>
          <v-toolbar dense>
            <v-toolbar-title>{{ selectedItem.name }}</v-toolbar-title>
            <v-spacer />
            <v-btn icon small @click="showGetInLineDialog=false">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </v-toolbar>
          <v-card-title>Get in line</v-card-title>
          <v-stepper v-model="step" vertical>
            <!-- Step 1 - verify supporting member -->

            <v-stepper-step step="1" :complete="step > 1">
              Confirm eligibility
            </v-stepper-step>
            <v-stepper-content step="1">
              <p>In order to borrow the {{ selectedItem.shortName }} you must be a supporting member for at least {{ selectedItem.supportingMemberDays }} days.</p>
              <p>Did you become a supporting member on or before {{ supportingMemberDate(selectedItem.supportingMemberDays) }}?</p>
              <v-btn
                text
                @click="++step"
              >
                Yes
              </v-btn>
              <v-btn
                text
                @click="showGetInLineDialog = false"
              >
                No
              </v-btn>
            </v-stepper-content>

            <!-- Step 2 - enter phone number -->
            <v-stepper-step step="2" :complete="step > 2">
              Enter your phone number
            </v-stepper-step>
            <v-stepper-content step="2">
              <p>You must have a verified phone number to borrow the {{ selectedItem.shortName }}.</p>
              <p>We will send a code to this number via SMS. Please enter your phone number below.</p>
              <p
                v-if="otpSendFailed"
                class="error--text"
              >
                There was a problem sending the code, please try again after 30 seconds.
              </p>
              <v-text-field
                v-model="phoneNumber"
                outlined
                label="Phone number"
                :rules="[validatePhoneNumber]"
              />
              <p>We also need your consent to contact you about the {{ selectedItem.shortName }} when you have it.</p>
              <div>
                <v-spacer />
                <v-checkbox
                  v-model="consent"
                  label="I consent"
                  :ripple="false"
                />
              </div>
              <v-btn
                text
                :disabled="!consent || validatePhoneNumber(phoneNumber) !== true || otpSendFailed"
                :loading="sendingOtp"
                @click="sendOtp"
              >
                Continue
              </v-btn>
            </v-stepper-content>

            <!-- Step3 - enter code -->
            <v-stepper-step step="3" :complete="step > 3">
              Verify your phone number
            </v-stepper-step>
            <v-stepper-content step="3">
              <p>
                We've sent a six digit code to {{ phoneNumberString }}, please enter it below when you receive it.
              </p>
              <v-form ref="otpForm">
                <v-text-field
                  v-model="otp"
                  outlined
                  label="Verification code"
                  :rules="[validateOtp]"
                />
              </v-form>
              <v-btn
                text
                :disabled="validateOtp(otp) !== true || sendingOtp"
                :loading="verifyingOtp"
                @click="verifyOtp"
              >
                Continue
              </v-btn>
              <v-btn
                text
                :disabled="verifyingOtp || tooSoonToResend"
                :loading="sendingOtp"
                @click="sendOtp"
              >
                Resend code
              </v-btn>
            </v-stepper-content>
            <!-- Step 4 - finished -->
            <v-stepper-step step="4" :complete="step > 3">
              You're in line
            </v-stepper-step>
            <v-stepper-content step="4">
              <p>
                That's it, you're in line.
              </p>
              <v-btn
                text
                @click="showGetInLineDialog = false"
              >
                OK
              </v-btn>
            </v-stepper-content>
          </v-stepper>
        </v-card>
      </v-dialog>

      <!-- A dialog to drop out of the line -->
      <v-dialog
        v-if="selectedItem"
        v-model="showDropOutDialog"
        max-width="375px"
        persistent
      >
        <v-card>
          <v-toolbar dense>
            <v-toolbar-title>{{ selectedItem.name }}</v-toolbar-title>
            <v-spacer />
            <v-btn icon small @click="showDropOutDialog=false">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </v-toolbar>
          <v-card-title>Drop out</v-card-title>
          <v-card-text>
            <p>
              Are you sure you want to drop out? You'll lose your place in line.
            </p>
            <v-btn
              text
              :disabled="droppingOut"
              @click="showDropOutDialog = false"
            >
              No
            </v-btn>
            <v-btn
              text
              :loading="droppingOut"
              @click="dropOut"
            >
              Yes
            </v-btn>
          </v-card-text>
        </v-card>
      </v-dialog>

      <!-- A dialog to say that you have received the item or gave it to someone else -->
      <v-dialog
        v-if="selectedItem"
        v-model="showTransferDialog"
        max-width="375px"
        persistent
      >
        <v-card>
          <v-toolbar dense>
            <v-toolbar-title>{{ selectedItem.name }}</v-toolbar-title>
            <v-spacer />
            <v-btn icon small @click="showTransferDialog=false">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </v-toolbar>
          <v-card-title v-if="selectedItem.hasIt">
            You gave it to someone else
          </v-card-title>
          <v-card-title v-else>
            You received the {{ selectedItem.shortName }}
          </v-card-title>
          <v-card-text>
            <p v-if="selectedItem.hasIt">
              Just tell us who it was.
            </p>
            <p v-else>
              Just tell us who gave it to you.
            </p>
            <v-autocomplete
              v-model="otherUserId"
              :items="targets"
              outlined
              hide-details
            />
            <v-btn
              text
              :loading="transferring"
              :disabled="!otherUserId"
              @click="transferIt"
            >
              OK
            </v-btn>
          </v-card-text>
        </v-card>
      </v-dialog>
    </v-row>

    <!-- --------------------------------------------------------------------------- -->
    <!-- A row for the item cards -->
    <!-- --------------------------------------------------------------------------- -->
    <v-row>
      <v-col
        v-for="item in items"
        :key="item.itemId"
        cols="auto"
      >
        <v-card width="375px">
          <v-img
            height="300px"
            :src="item.picture ? `/bc/${item.picture}` : `/bc/picture-placeholder.png`"
          />
          <v-card-title v-text="item.name" />
          <v-list dense>
            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-book-open-variant</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title>
                  <a :href="item.rules" target="_blank">Rules</a> and <a :href="item.instructions" target="_blank">instructions</a>
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>

            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-pound-box-outline</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title>
                  {{ item.quantity }} available
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>

            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-account-clock-outline</v-icon>
              </v-list-item-icon>

              <v-list-item-content>
                <v-list-item-title>
                  Borrow it for up to {{ item.maxDays }} days
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>

            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-crown-outline</v-icon>
              </v-list-item-icon>

              <v-list-item-content>
                <v-list-item-title>
                  Managed by
                  <a :href=" item.manager.viewUrl " target="_blank">
                    {{ item.manager.name }}
                  </a>
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>
          </v-list>
          <v-divider />

          <!-- If this user is banned -->

          <v-card-text v-if="ban">
            You are banned from borrowing the {{ item.shortName }}
          </v-card-text>

          <!-- If this user has it  -->

          <v-card-text v-else-if="item.hasIt">
            <p>
              You have the {{ item.shortName }}.
            </p>
            <v-btn
              small
              color="secondary"
              :loading="loadingQueue"
              @click.stop="showTransferDialogFor(item)"
            >
              You passed it on
            </v-btn>
          </v-card-text>

          <!-- If this user is waiting for it -->

          <v-card-text v-else-if="item.inList">
            <p>
              You are in line, you can drop out if you no longer need the {{ item.shortName }} or you can tell us that you received it.
            </p>
            <v-btn
              small
              color="secondary"
              @click.stop="showDropOutDialogFor(item)"
            >
              Drop out
            </v-btn>
            <v-btn
              small
              color="secondary"
              :loading="loadingQueue"
              @click.stop="showTransferDialogFor(item)"
            >
              You got the {{ item.shortName }}
            </v-btn>
          </v-card-text>

          <!-- Otherwise, this user can get in line -->

          <v-card-text v-else>
            <v-btn
              small
              color="secondary"
              @click.stop="showGetInLineDialogFor(item)"
            >
              Get in line
            </v-btn>
          </v-card-text>
          <v-divider />
          <v-btn
            small
            text
            class="ma-1"
            color="secondary"
            @click="showQueueFor(item)"
          >
            {{ item.showQueue ? 'Hide' : 'Show' }} queue
            <v-icon>{{ item.showQueue ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
          </v-btn>

          <v-expand-transition>
            <div v-if="item.showQueue">
              <v-divider />
              <v-progress-linear v-if="loadingQueue" indeterminate />
              <div v-else>
                <v-card-text><h3>Have the {{ item.shortName }}</h3></v-card-text>
                <v-simple-table dense>
                  <template v-slot:default>
                    <tbody>
                      <tr
                        v-for="entry in item.queue.haves"
                        :key="entry.user.id"
                      >
                        <td class="text-left">
                          <a :href="entry.user.viewUrl" target="_blank">{{ you(entry.user) }}</a>
                          <span v-if="entry.overdue" class="error--text"><strong> for {{ entry.age }}</strong></span>
                          <span v-else> for {{ entry.age }}</span>
                        </td>
                        <td class="text-right">
                          {{ entry.user.location }}
                        </td>
                      </tr>
                    </tbody>
                  </template>
                </v-simple-table>
                <v-card-text><h3>Waiting for the {{ item.shortName }}</h3></v-card-text>
                <v-simple-table dense>
                  <template v-slot:default>
                    <tbody>
                      <tr
                        v-for="entry in item.queue.waiters"
                        :key="entry.user.id"
                      >
                        <td
                          class="text-left"
                        >
                          <a :href="entry.user.viewUrl" target="_blank">{{ you(entry.user) }}</a>
                          <span> {{ entry.eta }}</span>
                        </td>
                        <td
                          class="text-right"
                        >
                          {{ entry.user.location }}
                        </td>
                      </tr>
                    </tbody>
                  </template>
                </v-simple-table>
              </div>
            </div>
          </v-expand-transition>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
<script>
function cleanPhoneNumber (text) {
  return text.replace(/[^\d]/g, '')
}
export default {
  async fetch () {
    const { user, items, ban } = await this.$axios.$get('/api/equipment')
    this.user = user
    items.forEach((item, index) => {
      item.index = index
      item.showQueue = false
      item.queue = undefined
    })
    this.items = items
    this.ban = ban
    items.forEach((item) => {
      item.step = 1
    })
  },
  data () {
    return {
      user: {},
      items: [],
      ban: undefined,

      // The item we're working with in a dialog
      selectedItem: null,
      // Toggles visibility of the get in line dialog
      showGetInLineDialog: false,
      // Toggles visibility of the drop-out dialog
      showDropOutDialog: false,
      // Toggles visibility of the transfer dialog
      showTransferDialog: false,
      // The current step in the get in line dialog
      step: 1,
      // The phone number entered
      phoneNumber: undefined,
      // Consent to receive messages
      consent: false,
      // Set to true while we are sending the OTP
      sendingOtp: false,
      // Set to true when there is a problem sending the OTP
      otpSendFailed: false,
      // If it is too soon to resend the code
      tooSoonToResend: true,
      // The otp entered in the text field
      otp: undefined,
      // While we are verifying the OTP
      verifyingOtp: false,
      // If the OTP was incorrect
      otpIncorrect: false,
      // Set to true while we are dropping out
      droppingOut: false,
      // Set to true while we are loading an item's queue
      loadingQueue: false,
      // The user ID that was selected when a user says
      // they received the item or gave it to someone else
      otherUserId: undefined,
      // Set to true while we are transferring the item
      // from one user to another
      transferring: false,
      // Targets for the transfer auto complete
      targets: [],
      // Set to true when the queue is visible
      showQueue: []
    }
  },
  computed: {
    // Human friendly phone number
    phoneNumberString () {
      if (!this.phoneNumber) {
        return
      }
      const clean = cleanPhoneNumber(this.phoneNumber)
      return `${clean.substr(0, 3)}-${clean.substr(3, 3)}-${clean.substr(6)}`
    }
  },
  watch: {
    // When the OTP they type in changes, we reset the
    // incorrect flag
    otp () {
      this.otpIncorrect = false
    }
  },
  methods: {
    showGetInLineDialogFor (item) {
      // Before we show the dialog, we reset its state
      // of its state
      this.step = 1
      this.phoneNumber = undefined
      this.consent = false
      this.sendingOtp = false
      this.otpSendFailed = false
      this.tooSoonToResend = true
      this.otp = undefined
      this.verifyingOtp = false
      this.otpIncorrect = false
      this.selectedItem = item
      this.showGetInLineDialog = true
    },
    showDropOutDialogFor (item) {
      this.droppingOut = false
      this.selectedItem = item
      this.showDropOutDialog = true
    },
    async showTransferDialogFor (item) {
      this.selectedItem = item
      this.otherUserId = undefined
      this.transferring = false
      // If we don't have the queue already, go get it
      if (!item.queue) {
        this.loadingQueue = true
        const url = `/api/equipment/queue/${item.itemId}`
        const { queue } = await this.$axios.$get(url)
        item.queue = queue
        this.loadingQueue = false
      }
      // Now, populate the targets of the transfer
      const target = item.hasIt ? item.queue.waiters : item.queue.haves
      this.targets = target.map(({ user: { id, name } }) => ({
        value: id,
        text: name
      }))
      // Show the dialog
      this.showTransferDialog = true
    },
    async showQueueFor (item) {
      item.showQueue = !item.showQueue
      if (!item.showQueue) {
        return
      }
      if (item.queue) {
        return
      }
      this.loadingQueue = true
      const url = `/api/equipment/queue/${item.itemId}`
      const { queue } = await this.$axios.$get(url)
      item.queue = queue
      this.loadingQueue = false
    },
    validatePhoneNumber (value) {
      if (!value) {
        return 'The phone number is required'
      }
      const digits = cleanPhoneNumber(value)
      if (digits.length !== 10) {
        return 'Please entery a valid ten digit phone number'
      }
      return true
    },
    validateOtp (value) {
      if (!value) {
        return 'The code is required'
      }
      if (this.otpIncorrect) {
        return 'That code is incorrect'
      }
      const digits = cleanPhoneNumber(value)
      if (digits.length !== 6) {
        return 'Please enter a six digit code'
      }
      return true
    },
    supportingMemberDate (supportingMemberDays) {
      const today = new Date()
      today.setDate(today.getDate() - supportingMemberDays)
      return today.toLocaleDateString()
    },
    you (user) {
      return this.user.id === user.id ? 'You' : user.name
    },
    async sendOtp () {
      this.sendingOtp = true
      const formData = new FormData()
      formData.set('phoneNumber', cleanPhoneNumber(this.phoneNumber))
      const url = '/api/equipment/otp'
      const { failed } = await this.$axios.$post(url, formData)
      this.sendingOtp = false
      if (failed) {
        this.otpSendFailed = true
        setTimeout(() => {
          this.otpSendFailed = false
        }, 30000)
        return
      }
      // Otherwise, it was sent and we can move to the next step
      // But first, we set a timeout to enable the resend button
      this.tooSoonToResend = true
      setTimeout(() => {
        this.tooSoonToResend = false
      }, 35000)
      this.step = 3
    },
    async verifyOtp () {
      const item = this.selectedItem
      this.verifyingOtp = true
      const formData = new FormData()
      formData.set('otp', cleanPhoneNumber(this.otp))
      const url = `/api/equipment/queue/${item.itemId}`
      const { incorrect, queue } = await this.$axios.$post(url, formData)
      this.verifyingOtp = false
      if (incorrect) {
        this.otpIncorrect = true
        this.$refs.otpForm.validate()
        return
      }
      // Now, the user is in the list
      item.inList = true
      // And we have the latest queue for this item
      item.queue = queue
      // Final step
      this.step = 4
    },
    async dropOut () {
      const item = this.selectedItem
      this.droppingOut = true
      const url = `/api/equipment/queue/${item.itemId}`
      const { queue } = await this.$axios.$delete(url)
      // Now, the user is not in the list
      item.inList = false
      // And we have the latest queue for this item
      item.queue = queue
      // Turn off loading
      this.droppingOut = false
      // Close the dialog
      this.showDropOutDialog = false
    },
    async transferIt () {
      const item = this.selectedItem
      this.transferring = true
      const verb = item.hasIt ? 'to' : 'from'
      const url = `/api/equipment/queue/${item.itemId}/${verb}/${this.otherUserId}`
      const { queue } = await this.$axios.$put(url)
      if (item.hasIt) {
        // If we had it and gave it to someone else, we no
        // longer have it and we're not in the list
        item.hasIt = false
        item.inList = false
      } else {
        // Otherwise, we got it from someone else, so we have it
        // and we're still in the list
        item.hasIt = true
      }
      // Update the queue
      item.queue = queue
      // Turn off loading
      this.transferring = false
      // Close the dialog
      this.showTransferDialog = false
    }
  }
}
</script>
