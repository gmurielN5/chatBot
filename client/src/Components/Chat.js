import { useContext } from "react"
import { context } from "../context"
import { Field, Form, Formik } from "formik"
import * as Yup from "yup"
import "../Style/chat.scss"

export const Chat = ({ player }) => {
  const { socket, players, setPlayers } = useContext(context)
  console.log(players)
  return (
    <div className="message-input">
      <Formik
        initialValues={{ message: "" }}
        validationSchema={Yup.object({
          message: Yup.string().min(1).max(255),
        })}
        onSubmit={(values, actions) => {
          socket.emit("private message", {
            content: values.message,
            to: player.userID,
          })
          setPlayers((prevState) => {
            const updatePlayer = prevState.map((obj) => {
              if (obj.userID === player.userID) {
                return {
                  ...obj,
                  message: [{ content: values.message, fromSelf: true }],
                }
              }
              return obj
            })
            return updatePlayer
          })
          actions.resetForm()
        }}
      >
        <Form>
          <Field
            id="message"
            name="message"
            placeholder="Type your message here..."
          />
          <button type="submit">Submit</button>
        </Form>
      </Formik>
    </div>
  )
}
