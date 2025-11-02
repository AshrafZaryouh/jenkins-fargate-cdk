FROM jenkins/jenkins:lts-jdk11

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli -f /usr/share/jenkins/ref/plugins.txt

# change permission for EFS mount point from root to jenkins
# RUN chown jenkins:jenkins /var/jenkins_home

USER root